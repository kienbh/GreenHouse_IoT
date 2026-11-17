// App nhà kính chạy local trên PC: MQTT client nối tới broker Mosquitto
//  - Đăng ký vju/nhakinh/+/{status,telemetry,event,cmd,ack}, lưu nguyên mỗi bản tin vào SQLite (Bài 5)
//  - Giữ trạng thái mới nhất của từng ESP32; ghi CSV theo ngày: data/<thiết bị>/telemetry-YYYY-MM-DD.csv
//  - Bài 6: vòng lệnh giao diện -> API kiểm quyền -> broker -> ESP32 -> ack theo cmd_id, quá hạn thì báo "chưa xác nhận"
//  - Bài 7: luật thông gió tự động (rules.js), chế độ tự động/thủ công, nhật ký quyết định
//  - Bài 8: đăng nhập theo vai (auth.js), audit log, MQTT qua TLS, HTTPS cho truy cập qua mạng
import mqtt from 'mqtt';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openMessageStore } from './mqtt-store.js';
import { openAppDb } from './app-db.js';
import { createAuth, can, actionFor, parseCookies, PERMISSIONS } from './auth.js';
import { RULE, evaluate, commandFor } from './rules.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MQTT_URL = process.env.MQTT_URL || 'mqtts://localhost:8883';
const MQTT_CA = process.env.MQTT_CA || path.join(DIR, '..', 'mqtt_broker', 'tls', 'ca.crt');
const BASE = (process.env.MQTT_BASE || 'vju/nhakinh').replace(/\/+$/, '');
const TOPIC_KINDS = ['status', 'telemetry', 'event', 'cmd', 'ack'];
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(DIR, 'data'));
const DB_FILE = path.join(DATA_DIR, 'mqtt.sqlite');
const messageStore = openMessageStore(DB_FILE);
const appDb = openAppDb(DB_FILE);
process.once('exit', () => { messageStore.close(); appDb.close(); });
console.log(`SQLite: ${DB_FILE}`);
const PORT = Number(process.env.PORT ?? 3000);
const HTTP_HOST = process.env.HTTP_HOST || '127.0.0.1';      // HTTP chỉ cho chính máy này; qua mạng dùng HTTPS
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const TLS_CERT = process.env.TLS_CERT || path.join(DIR, '..', 'mqtt_broker', 'tls', 'server.crt');
const TLS_KEY = process.env.TLS_KEY || path.join(DIR, '..', 'mqtt_broker', 'tls', 'server.key');
const ACK_TIMEOUT_MS = Number(process.env.ACK_TIMEOUT_MS || 5000);
const HIST_MAX = 1440;      // số điểm giữ trong RAM cho biểu đồ (~2 giờ ở chu kỳ 5 s)
const EVT_MAX = 200;
const auth = createAuth({ usersFile: process.env.USERS_FILE || path.join(DIR, 'users.json') });
if (!auth.hasUsers()) console.log('CHUA CO TAI KHOAN: tao bang "node tools/user.js init" truoc khi dang nhap');

// ===== Trạng thái từng thiết bị =====
const devices = new Map();  // tên -> { status, tele, teleAt, seen, hist: [[ts, t, h]], events: [] }
function dev(name) {
  if (!devices.has(name)) {
    devices.set(name, { status: 'unknown', tele: null, teleAt: 0, seen: 0, hist: loadHistory(name), events: [] });
  }
  return devices.get(name);
}
const modeOf = (name) => appDb.getSetting(`mode:${name}`, 'manual');

// ===== Ghi CSV =====
const TELE_HEAD = 'time,t,h,code,ledR,ledG,ledArray,auto,th,pump_st,duty,out,rssi\n';
const EVT_HEAD = 'time,level,boot,ms,msg\n';
const today = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const csvFile = (name, kind, date = today()) => path.join(DATA_DIR, name, `${kind}-${date}.csv`);
const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);

function appendCsv(name, kind, head, cells) {
  const f = csvFile(name, kind);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, head);
  fs.appendFileSync(f, cells.map(csvCell).join(',') + '\n');
}

// Khởi động lại app vẫn có biểu đồ: đọc lại các dòng cuối của file CSV hôm nay
function loadHistory(name) {
  const f = csvFile(name, 'telemetry');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).slice(-HIST_MAX).map((line) => {
    const [time, t, h] = line.split(',');
    return [Date.parse(time), t === '' ? null : +t, h === '' ? null : +h];
  });
}

// ===== MQTT (TLS nếu URL là mqtts://) =====
let brokerOk = false;
const tlsOpts = MQTT_URL.startsWith('mqtts:') ? { ca: fs.readFileSync(MQTT_CA), rejectUnauthorized: true } : {};
const client = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  clientId: `nhakinh-app-${process.pid}`,
  reconnectPeriod: 3000,
  ...tlsOpts,
});

client.on('connect', () => {
  brokerOk = true;
  console.log(`MQTT: da ket noi ${MQTT_URL}`);
  client.subscribe(TOPIC_KINDS.map((kind) => `${BASE}/+/${kind}`), { qos: 1 });
  broadcast({ kind: 'broker', ok: true });
});
client.on('close', () => {
  if (brokerOk) console.log('MQTT: mat ket noi broker, dang thu lai...');
  brokerOk = false;
  broadcast({ kind: 'broker', ok: false });
});
client.on('error', (e) => console.log('MQTT loi:', e.message));

client.on('message', (topic, buf, packet) => {
  if (!topic.startsWith(`${BASE}/`)) return;
  const [name, kind, extra] = topic.slice(BASE.length + 1).split('/');
  if (!name || name === '.' || name === '..' || extra !== undefined || !TOPIC_KINDS.includes(kind)) return;
  const ts = Date.now();
  try {
    // Ghi trước khi parse: không bỏ bản tin trùng giá trị, retained hoặc JSON lỗi.
    messageStore.append(topic, buf, packet, ts);
  } catch (err) {
    console.error(`SQLite: khong luu duoc ban tin ${topic}: ${err.message}`);
  }
  // Chỉ quan sát lệnh trên broker; không xử lý hoặc phát lại lệnh.
  if (kind === 'cmd') return;
  const d = dev(name);
  const text = buf.toString();
  d.seen = ts;
  let data = text;
  if (kind === 'status') {
    d.status = text;
    console.log(`[${name}] ${text}`);
  } else {
    try { data = JSON.parse(text); } catch { console.log(`[${name}] ${kind} khong phai JSON: ${text}`); return; }
  }
  if (kind === 'ack') return onAck(name, data, ts);
  if (kind === 'telemetry') {
    // Bản ghi gửi bù (Bài 9) chỉ có số đo cũ: đã lưu SQLite, không thay trạng thái trực tiếp
    if (data.replay) { broadcast({ kind: 'replay', dev: name, ts, data }); return; }
    d.tele = data; d.teleAt = ts;
    d.hist.push([ts, data.t, data.h]);
    if (d.hist.length > HIST_MAX) d.hist.shift();
    const p = data.pump || {};
    appendCsv(name, 'telemetry', TELE_HEAD, [new Date(ts).toISOString(), data.t, data.h, data.code,
      data.ledR, data.ledG, data.ledArray, data.auto, data.th, p.st, p.duty, p.out, data.rssi]);
  } else if (kind === 'event') {
    data.ts = ts;
    d.events.push(data);
    if (d.events.length > EVT_MAX) d.events.shift();
    appendCsv(name, 'events', EVT_HEAD, [new Date(ts).toISOString(), data.lv, data.boot, data.ms, data.msg]);
    console.log(`[${name}] ${data.lv} ${data.msg}`);
  }
  broadcast({ kind, dev: name, ts, data });
  if (kind === 'telemetry') runRule(name, d, ts);
});

// ===== Bài 6: vòng lệnh có xác nhận =====
// "Đã gửi" (broker nhận) khác "đã áp dụng" (ESP32 ack). Quá ACK_TIMEOUT_MS chưa ack = "timeout":
// CHƯA XÁC NHẬN, không có nghĩa thiết bị không làm hoặc đã dừng.
const ackTimers = new Map();
let cmdSeq = 0;
const newCmdId = (name) => `${name}-${Date.now().toString(36)}-${(++cmdSeq).toString(36)}`;

function publishCmd(row) {
  return new Promise((resolve, reject) => {
    client.publish(`${BASE}/${row.dev}/cmd`, row.payload, { qos: 1 }, (err) => {
      if (err) return reject(err);
      appDb.markSent(row.cmd_id, Date.now());
      clearTimeout(ackTimers.get(row.cmd_id));
      ackTimers.set(row.cmd_id, setTimeout(() => {
        ackTimers.delete(row.cmd_id);
        const c = appDb.getCommand(row.cmd_id);
        if (c?.status !== 'pending') return;
        appDb.setCommandStatus({ cmd_id: row.cmd_id, status: 'timeout', reason: `khong nhan ack sau ${ACK_TIMEOUT_MS / 1000} s` });
        console.log(`[${row.dev}] ${row.cmd_id} QUA HAN: chua xac nhan`);
        broadcast({ kind: 'cmd', dev: row.dev, data: appDb.getCommand(row.cmd_id) });
      }, ACK_TIMEOUT_MS));
      resolve();
    });
  });
}

async function issueCommand(name, cmd, who, src = 'manual') {
  const cmd_id = newCmdId(name);
  const payload = JSON.stringify({ ...cmd, cmd_id, src });
  const row = { cmd_id, dev: name, user: who.user, role: who.role, src, payload, created_at: Date.now() };
  appDb.insertCommand(row);
  broadcast({ kind: 'cmd', dev: name, data: appDb.getCommand(cmd_id) });
  await publishCmd(row);
  console.log(`[${name}] <- ${payload} (${who.user})`);
  return appDb.getCommand(cmd_id);
}

// Gửi lại ĐÚNG cmd_id cũ: ESP32 nhận ra lệnh trùng, không chạy lại (không khởi động lại thời gian bơm)
async function resendCommand(id) {
  const row = appDb.getCommand(id);
  if (!row) return null;
  appDb.setCommandStatus({ cmd_id: id, status: 'pending', reason: `gui lai lan ${row.sends + 1}` });
  await publishCmd(row);
  broadcast({ kind: 'cmd', dev: row.dev, data: appDb.getCommand(id) });
  return appDb.getCommand(id);
}

function onAck(name, ack, ts) {
  const id = typeof ack?.cmd_id === 'string' ? ack.cmd_id : '';
  const row = id && appDb.getCommand(id);
  if (!row || row.dev !== name) {
    console.log(`[${name}] ack khong khop lenh nao: ${JSON.stringify(ack)}`);
    appDb.audit({ user: name, role: 'device', action: 'ack', dev: name, cmd_id: id || null, detail: JSON.stringify(ack), result: 'unknown_cmd' });
    return;
  }
  const status = ['applied', 'rejected', 'duplicate'].includes(ack.status) ? ack.status : 'rejected';
  const late = row.status === 'timeout';
  const reason = [ack.reason, ack.status === 'duplicate' && 'lenh trung, khong thuc hien lai', late && 'ack den muon (sau khi da bao qua han)']
    .filter(Boolean).join('; ') || null;
  clearTimeout(ackTimers.get(id)); ackTimers.delete(id);
  appDb.setCommandStatus({ cmd_id: id, status, reason, ack_at: new Date(ts).toISOString(), ack_payload: JSON.stringify(ack),
    latency_ms: row.sent_at ? ts - Date.parse(row.sent_at) : null });
  console.log(`[${name}] ack ${id} ${status}${reason ? ' (' + reason + ')' : ''}`);
  broadcast({ kind: 'cmd', dev: name, data: appDb.getCommand(id) });
}

// ===== Bài 7: luật tự động =====
const ruleCtx = new Map();  // tên -> { lastCmdAt, lastOnAt }
function runRule(name, d, now) {
  const mode = modeOf(name);
  if (mode !== 'auto') return;
  const ctx = ruleCtx.get(name) || {};
  ruleCtx.set(name, ctx);
  const r = evaluate(d.tele, d.teleAt, { mode, now, ...ctx });
  const cmd = commandFor(r.decision);
  const log = { dev: name, rule: RULE.name, mode, t: d.tele?.t ?? null, data_age_ms: now - d.teleAt, fan: d.tele?.ledG ?? null,
                decision: r.decision, reason: r.reason, test: d.tele?.src === 'test' ? 1 : 0 };
  if (!cmd || !brokerOk) {
    appDb.ruleLog({ ...log, reason: cmd ? `${r.reason}; mat broker, khong gui` : r.reason });
    return;
  }
  ctx.lastCmdAt = now;
  if (cmd.ledG) ctx.lastOnAt = now;
  issueCommand(name, cmd, { user: 'rule', role: 'service' }, 'auto')
    .then((c) => { appDb.ruleLog({ ...log, cmd_id: c.cmd_id }); broadcast({ kind: 'rule', dev: name, data: { ...log, cmd_id: c.cmd_id, at: new Date().toISOString() } }); })
    .catch((e) => appDb.ruleLog({ ...log, reason: `${r.reason}; loi gui: ${e.message}` }));
}

// Telemetry ngừng đến thì luật không được gọi: nhịp kiểm 5 s ghi lại "dữ liệu quá cũ, không quyết định"
// (mỗi 30 s một dòng). Khi đó node tự tắt tải do luật bật nhờ lease hết hạn.
setInterval(() => {
  const now = Date.now();
  for (const [name, d] of devices) {
    if (modeOf(name) !== 'auto' || !d.teleAt || now - d.teleAt <= RULE.staleMs) continue;
    const ctx = ruleCtx.get(name) || {};
    ruleCtx.set(name, ctx);
    if (ctx.lastStaleLog && now - ctx.lastStaleLog < 30000) continue;
    ctx.lastStaleLog = now;
    const r = evaluate(d.tele, d.teleAt, { mode: 'auto', now, ...ctx });
    appDb.ruleLog({ dev: name, rule: RULE.name, mode: 'auto', t: d.tele?.t ?? null, data_age_ms: now - d.teleAt, fan: d.tele?.ledG ?? null,
                    decision: r.decision, reason: `${r.reason}; node tu tat khi het lease` });
  }
}, 5000).unref();

// ===== Web: giao diện + SSE + API =====
const sseClients = new Set();
function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) res.write(line);
}

function snapshot() {
  const out = {};
  for (const [name, d] of devices) out[name] = { ...d, mode: modeOf(name) };
  return { broker: brokerOk, url: MQTT_URL, base: BASE, devices: out, rule: RULE };
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 4096) req.destroy(); });
    req.on('end', () => resolve(s));
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.crt': 'application/x-x509-ca-cert',
               '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };

const json = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};
const ipOf = (req) => req.socket.remoteAddress;
const validDev = (n) => typeof n === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(n);

// Từ chối = 401 (chưa đăng nhập) hoặc 403 (thiếu quyền), luôn ghi audit với ai/việc gì/từ đâu
function guard(req, res, action, detail = {}) {
  const s = auth.session(parseCookies(req.headers.cookie).sid);
  if (s && can(s.role, action)) return s;
  appDb.audit({ user: s?.user || null, role: s?.role || null, ip: ipOf(req), action, result: s ? 'forbidden' : 'unauthenticated',
                dev: detail.dev || null, detail: JSON.stringify({ path: req.url, ...detail }) });
  json(res, s ? 403 : 401, { ok: false, err: s ? `vai ${s.role} khong duoc phep: ${action}` : 'chua dang nhap' });
  return null;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  const secure = !!req.socket.encrypted;

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(DIR, 'public', 'index.html')).pipe(res);
  }
  // CA công khai để điện thoại cài làm chứng chỉ tin cậy (không phải khóa bí mật)
  if (url.pathname === '/ca.crt') {
    res.writeHead(200, { 'Content-Type': MIME['.crt'], 'Content-Disposition': 'attachment; filename="nhakinh-ca.crt"' });
    return fs.createReadStream(MQTT_CA).pipe(res);
  }

  // ----- Đăng nhập -----
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { ok: false, err: 'body khong phai JSON' }); }
    const r = auth.login(String(body.user || ''), String(body.pass || ''), ipOf(req));
    appDb.audit({ user: String(body.user || '').slice(0, 40), role: r.role || null, ip: ipOf(req), action: 'login', result: r.error ? (r.locked ? 'locked' : 'denied') : 'ok' });
    if (r.error) return json(res, r.locked ? 429 : 401, { ok: false, err: r.error });
    return json(res, 200, { ok: true, user: r.user, role: r.role },
      { 'Set-Cookie': `sid=${r.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}` });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    auth.logout(parseCookies(req.headers.cookie).sid);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  // Danh sách tài khoản + vai + quyền để kiểm thử. Không bao giờ trả băm mật khẩu.
  // Mật khẩu (từ data/accounts-app.local) CHỈ trả khi: bật SHOW_TEST_PASSWORDS=1 VÀ yêu cầu từ chính máy này.
  if (url.pathname === '/api/accounts') {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ipOf(req));
    const show = local && process.env.SHOW_TEST_PASSWORDS === '1';
    let plain = {};
    if (show) {
      try {
        plain = Object.fromEntries(fs.readFileSync(path.join(DATA_DIR, 'accounts-app.local'), 'utf8').trim().split('\n')
          .map((l) => l.split(' ')).map(([u, , p]) => [u, p]));
      } catch { plain = {}; }
    }
    const accounts = Object.entries(auth.users()).map(([user, u]) => ({
      user, role: u.role, can: Object.keys(PERMISSIONS).filter((a) => can(u.role, a)), ...(show && plain[user] ? { pass: plain[user] } : {}),
    }));
    return json(res, 200, { ok: true, accounts, permissions: PERMISSIONS, passwordsShown: show,
      note: show ? 'Che do kiem thu: mat khau hien vi SHOW_TEST_PASSWORDS=1 va truy cap tu localhost. Tat truoc khi demo.' : 'Mat khau khong hien thi.' });
  }
  if (url.pathname === '/api/me') {
    const s = auth.session(parseCookies(req.headers.cookie).sid);
    if (!s) return json(res, 401, { ok: false });
    return json(res, 200, { ok: true, user: s.user, role: s.role, can: Object.fromEntries(['view', 'control', 'configure', 'audit'].map((a) => [a, can(s.role, a)])) });
  }

  if (url.pathname === '/stream') {        // SSE: gửi ảnh chụp đầy đủ rồi từng tin MQTT
    if (!guard(req, res, 'view')) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ kind: 'snapshot', ...snapshot() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (url.pathname === '/api/devices') { if (!guard(req, res, 'view')) return; return json(res, 200, snapshot()); }

  // POST /api/cmd/<tên>  body: lệnh JSON, ví dụ {"ledR":1}; hoặc {"resend":"<cmd_id>"} để gửi lại đúng lệnh cũ
  if (parts[0] === 'api' && parts[1] === 'cmd' && parts[2] && req.method === 'POST') {
    const name = parts[2];
    let cmd;
    try { cmd = JSON.parse(await readBody(req)); } catch { return json(res, 400, { ok: false, err: 'body khong phai JSON' }); }
    if (!validDev(name) || !cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return json(res, 400, { ok: false, err: 'lenh phai la JSON object' });
    if (typeof cmd.resend === 'string') {
      const old = appDb.getCommand(cmd.resend);
      if (!old || old.dev !== name) return json(res, 404, { ok: false, err: 'khong co lenh nay' });
      const s = guard(req, res, actionFor(JSON.parse(old.payload, (k, v) => (['cmd_id', 'src', 'lease'].includes(k) ? undefined : v))), { dev: name, resend: old.cmd_id });
      if (!s) return;
      if (!brokerOk) return json(res, 503, { ok: false, err: 'chua ket noi broker' });
      appDb.audit({ user: s.user, role: s.role, ip: ipOf(req), action: 'resend', dev: name, cmd_id: old.cmd_id, detail: old.payload, result: 'sent' });
      return json(res, 202, { ok: true, cmd: await resendCommand(old.cmd_id) });
    }
    delete cmd.cmd_id; delete cmd.src; delete cmd.lease;       // các trường này do dịch vụ đặt, client không được tự đặt
    if (!Object.keys(cmd).length) return json(res, 400, { ok: false, err: 'lenh rong' });
    const action = actionFor(cmd);
    const s = guard(req, res, action, { dev: name, cmd });
    if (!s) return;
    // Ưu tiên: khóa an toàn / dừng bơm luôn được gửi; đèn quạt (ledG) đang do luật quản lý thì từ chối lệnh tay
    if ('ledG' in cmd && modeOf(name) === 'auto') {
      appDb.audit({ user: s.user, role: s.role, ip: ipOf(req), action, dev: name, detail: JSON.stringify(cmd), result: 'conflict_auto_mode' });
      return json(res, 409, { ok: false, err: 'LED xanh dang do luat tu dong quan ly. Chuyen sang thu cong truoc.' });
    }
    if (!brokerOk) return json(res, 503, { ok: false, err: 'chua ket noi broker' });
    try {
      const row = await issueCommand(name, cmd, s);
      appDb.audit({ user: s.user, role: s.role, ip: ipOf(req), action, dev: name, cmd_id: row.cmd_id, detail: JSON.stringify(cmd), result: 'sent' });
      return json(res, 202, { ok: true, cmd: row });
    } catch (e) {
      return json(res, 500, { ok: false, err: e.message });
    }
  }
  if (parts[0] === 'api' && parts[1] === 'commands' && parts[2]) {
    if (!guard(req, res, 'view')) return;
    return json(res, 200, { ok: true, commands: appDb.listCommands(parts[2], 30) });
  }

  // Bài 7: chế độ tự động/thủ công. Chuyển chế độ KHÔNG tự phát lại lệnh cũ; luật đánh giá lại ở telemetry kế tiếp.
  if (parts[0] === 'api' && parts[1] === 'mode' && parts[2] && req.method === 'POST') {
    let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { ok: false }); }
    if (!validDev(parts[2]) || !['auto', 'manual'].includes(body.mode)) return json(res, 400, { ok: false, err: 'mode phai la auto hoac manual' });
    const s = guard(req, res, 'control', { dev: parts[2], mode: body.mode });
    if (!s) return;
    const prev = modeOf(parts[2]);
    appDb.setSetting(`mode:${parts[2]}`, body.mode);
    ruleCtx.delete(parts[2]);
    appDb.audit({ user: s.user, role: s.role, ip: ipOf(req), action: 'mode', dev: parts[2], detail: `${prev} -> ${body.mode}`, result: 'ok' });
    appDb.ruleLog({ dev: parts[2], rule: RULE.name, mode: body.mode, decision: 'mode', reason: `${s.user} chuyen ${prev} -> ${body.mode}; khong phat lai lenh cu` });
    broadcast({ kind: 'mode', dev: parts[2], data: { mode: body.mode, by: s.user } });
    return json(res, 200, { ok: true, mode: body.mode });
  }
  if (parts[0] === 'api' && parts[1] === 'rules' && parts[2]) {
    if (!guard(req, res, 'view')) return;
    return json(res, 200, { ok: true, rule: RULE, mode: modeOf(parts[2]), log: appDb.listRuleLog(parts[2], 50) });
  }
  if (url.pathname === '/api/audit') {
    if (!guard(req, res, 'audit')) return;
    return json(res, 200, { ok: true, audit: appDb.listAudit(Number(url.searchParams.get('n')) || 100) });
  }

  // GET /api/csv/<tên>/<telemetry|events>?date=YYYY-MM-DD  -> tải file CSV
  if (parts[0] === 'api' && parts[1] === 'csv' && parts[2] && ['telemetry', 'events'].includes(parts[3])) {
    if (!guard(req, res, 'view')) return;
    const date = url.searchParams.get('date') || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !validDev(parts[2])) return json(res, 400, { ok: false });
    const f = csvFile(parts[2], parts[3], date);
    if (!fs.existsSync(f)) return json(res, 404, { ok: false, err: 'chua co du lieu' });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${parts[2]}-${path.basename(f)}"`,
    });
    return fs.createReadStream(f).pipe(res);
  }

  // File tĩnh: public/* (trang 3D, model .glb) và /vendor/three/* lấy từ node_modules, không cần CDN
  const vendor = parts[0] === 'vendor' && parts[1] === 'three';
  const base = vendor ? path.join(DIR, 'node_modules', 'three') : path.join(DIR, 'public');
  const file = path.join(base, ...(vendor ? parts.slice(2) : parts));
  if (file.startsWith(base + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }

  json(res, 404, { ok: false });
}

// Nạp lịch sử các thiết bị đã có dữ liệu để biểu đồ không trống khi vừa mở app
if (fs.existsSync(DATA_DIR)) {
  for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && validDev(entry.name)) dev(entry.name);
  }
}

const server = http.createServer(handler);
server.listen(PORT, HTTP_HOST, () => console.log(`Giao dien: http://localhost:${server.address().port}`));
if (HTTPS_PORT >= 0 && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)) {
  const secureServer = https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, handler);
  secureServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    const cn = new crypto.X509Certificate(fs.readFileSync(TLS_CERT)).subject.match(/CN=([^\n]+)/)?.[1];
    console.log(`Giao dien qua mang (HTTPS): https://${cn}:${secureServer.address().port}`);
  });
}
