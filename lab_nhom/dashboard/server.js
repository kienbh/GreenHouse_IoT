// Dashboard lớp học: nghe dữ liệu ESP32 của các nhóm SV qua MQTT và phát trực tiếp lên web
//  Quy ước (xem ../README.md):
//    vju/iot/<nhóm>          JSON {"nhom":"nhom01","temp":26.4,"hum":61.2,"pres":1008.6,"led":1,"btn":0}
//    vju/iot/<nhóm>/status   "online" / "offline" (retained, offline là Last Will)
//    vju/iot/<nhóm>/output   <- dashboard gửi "on" / "off" khi GV bấm bóng LED (giống esp32/output của bài RNT)
//  - Có dữ liệu là hiện, không cần đăng ký trước; tin sai vẫn hiện trong nhật ký kèm lý do để SV tự sửa
//  - Vẫn nhận cách gửi tách topic (vju/iot/<nhóm>/temperature ...) cho nhóm làm theo bài gốc
//  - Ghi CSV theo ngày: data/YYYY-MM-DD/<nhóm>.csv (time,field,value)
import mqtt from 'mqtt';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const BASE = process.env.MQTT_BASE || 'vju/iot';
const PORT = Number(process.env.PORT || 3100);
const HIST_MAX = 900;       // điểm biểu đồ mỗi nhóm (~75 phút ở chu kỳ 5 s)
const LOG_MAX = 400;        // dòng nhật ký MQTT giữ trong RAM
const CMD_WAIT_MS = 8000;   // chờ kit báo lại trạng thái LED sau khi GV gửi lệnh

// ===== Chuẩn hoá tên trường và giá trị =====
const FIELD = {
  temperature: 't', temp: 't', t: 't',
  humidity: 'h', hum: 'h', h: 'h',
  pressure: 'p', pres: 'p', p: 'p',
  led: 'led', button: 'btn', btn: 'btn',
  rssi: 'rssi', ip: 'ip', status: 'status',
};
const NUM = new Set(['t', 'h', 'p', 'rssi']);
const BOOL = new Set(['led', 'btn']);
const RANGE = { t: [-40, 85], h: [0, 100], p: [300, 1100] };   // dải đo AHT20 / BMP280
const NAME_RE = /^[\w.-]{1,32}$/;

function parseNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function parseBool(v) {
  const s = String(v).trim().toLowerCase();
  if (['1', 'on', 'true', 'high', 'bat', 'pressed'].includes(s)) return 1;
  if (['0', 'off', 'false', 'low', 'tat', 'released'].includes(s)) return 0;
  return null;
}

// ===== Trạng thái từng nhóm =====
const nodes = new Map();    // tên -> { status, seen, t, h, p, led, btn, btnCount, rssi, ip, msgs, hist: [[ts,t,h,p]] }
function node(name) {
  if (!nodes.has(name)) {
    nodes.set(name, { name, status: 'unknown', seen: 0, t: null, h: null, p: null, led: null, btn: null,
      btnCount: 0, rssi: null, ip: null, msgs: 0, hist: loadHistory(name) });
  }
  return nodes.get(name);
}

// Gán 1 trường đã chuẩn hoá. Trả về chuỗi cảnh báo nếu giá trị không hợp lệ
function setField(n, f, raw, ts) {
  if (f === 'status') { n.status = String(raw).trim().toLowerCase() === 'offline' ? 'offline' : 'online'; return null; }
  if (f === 'ip') { n.ip = String(raw).slice(0, 40); return null; }
  let v;
  if (NUM.has(f)) {
    v = parseNum(raw);
    if (v == null) return `"${raw}" không phải số`;
    const r = RANGE[f];
    if (r && (v < r[0] || v > r[1])) return `${v} ngoài dải đo (${r[0]}..${r[1]}), kiểm tra lại cảm biến/đơn vị`;
  } else if (BOOL.has(f)) {
    v = parseBool(raw);
    if (v == null) return `"${raw}" không hiểu là bật/tắt, nên gửi 1 hoặc 0`;
    if (f === 'btn' && v === 1 && n.btn !== 1) n.btnCount++;
    // Kit báo LED đúng trạng thái vừa ra lệnh -> lệnh điều khiển ngược đã chạy
    if (f === 'led' && n.cmd?.state === 'wait' && v === n.cmd.v) Object.assign(n.cmd, { state: 'ok', ms: ts - n.cmd.ts });
  }
  n[f] = v;
  if (n.status !== 'offline') n.status = 'online';   // có dữ liệu = đang sống (kể cả khi nhóm chưa làm LWT)
  if (f === 't' || f === 'h' || f === 'p') {
    // Các trường gửi tách topic tới gần như cùng lúc: gộp vào cùng 1 điểm nếu cách nhau < 2 s
    const last = n.hist[n.hist.length - 1];
    if (last && ts - last[0] < 2000) last[{ t: 1, h: 2, p: 3 }[f]] = v;
    else {
      n.hist.push([ts, n.t, n.h, n.p]);
      if (n.hist.length > HIST_MAX) n.hist.shift();
    }
  }
  appendCsv(n.name, ts, f, v);
  return null;
}

// ===== Ghi CSV =====
const day = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const csvFile = (name, date = day()) => path.join(DIR, 'data', date, `${name}.csv`);
function appendCsv(name, ts, field, value) {
  const f = csvFile(name, day(ts));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, 'time,field,value\n');
  fs.appendFileSync(f, `${new Date(ts).toISOString()},${field},${value ?? ''}\n`);
}
// Khởi động lại app vẫn còn biểu đồ: dựng lại từ CSV hôm nay
function loadHistory(name) {
  const f = csvFile(name);
  if (!fs.existsSync(f)) return [];
  const hist = [], cur = { t: null, h: null, p: null };
  for (const line of fs.readFileSync(f, 'utf8').trim().split('\n').slice(1)) {
    const [time, field, value] = line.split(',');
    if (!(field in cur)) continue;
    const ts = Date.parse(time);
    cur[field] = value === '' ? null : +value;
    const last = hist[hist.length - 1];
    if (last && ts - last[0] < 2000) last[{ t: 1, h: 2, p: 3 }[field]] = cur[field];
    else hist.push([ts, cur.t, cur.h, cur.p]);
  }
  return hist.slice(-HIST_MAX);
}

// ===== Nhật ký MQTT (để SV nhìn thấy tin của mình, kể cả tin sai) =====
const log = [];
function addLog(ts, topic, payload, warn) {
  const e = { ts, topic, payload: payload.length > 120 ? payload.slice(0, 120) + '…' : payload, warn };
  log.push(e);
  if (log.length > LOG_MAX) log.shift();
  return e;
}

// ===== MQTT =====
let brokerOk = false;
const client = mqtt.connect(MQTT_URL, {
  // Để trống = vô danh (cổng 1883, nhánh vju/iot/#)
  ...(process.env.MQTT_USER ? { username: process.env.MQTT_USER, password: process.env.MQTT_PASS } : {}),
  clientId: `lop-dashboard-${process.pid}`,
  reconnectPeriod: 3000,
});
client.on('connect', () => {
  brokerOk = true;
  console.log(`MQTT: da ket noi ${MQTT_URL}, nghe ${BASE}/#`);
  client.subscribe(`${BASE}/#`, { qos: 0 });
  broadcast({ kind: 'broker', ok: true });
});
client.on('close', () => {
  if (brokerOk) console.log('MQTT: mat ket noi broker, dang thu lai...');
  brokerOk = false;
  broadcast({ kind: 'broker', ok: false });
});
client.on('error', (e) => console.log('MQTT loi:', e.message));

client.on('message', (topic, buf) => {
  const ts = Date.now();
  const text = buf.toString().trim();
  const rest = topic.slice(BASE.length + 1).split('/');   // [nhóm, (trường)]
  let name = rest[0];
  const sub = rest.slice(1).join('/').toLowerCase();

  // Lệnh gửi xuống ESP32 chỉ ghi nhật ký, không phải dữ liệu
  if (sub === 'output' || sub === 'cmd' || sub.endsWith('/set')) return broadcast({ kind: 'log', entry: addLog(ts, topic, text, null) });

  const warns = [];
  let obj = null;
  const isJson = sub !== 'status' && text.startsWith('{');
  if (isJson) {
    try { obj = JSON.parse(text); } catch { warns.push('JSON sai cú pháp (thiếu dấu ", dấu phẩy hoặc ngoặc?)'); }
    // Gửi nhầm lên topic chung vju/iot thì lấy tên nhóm trong JSON
    const inJson = obj && (obj.nhom ?? obj.id);
    if (!name && inJson) name = String(inJson);
    else if (inJson && String(inJson) !== name) warns.push(`"nhom":"${inJson}" khác tên trên topic (${name})`);
  }
  if (!name || !NAME_RE.test(name)) {
    return broadcast({ kind: 'log', entry: addLog(ts, topic, text, 'topic phải có dạng vju/iot/nhomXX') });
  }

  const n = node(name);
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'nhom' || k === 'id') continue;
      const f = FIELD[k.toLowerCase()];
      if (!f) { warns.push(`khoá "${k}" không dùng`); continue; }
      const w = setField(n, f, v, ts);
      if (w) warns.push(`${k}: ${w}`);
    }
    const miss = ['temp', 'hum'].filter((k) => !(k in obj) && !(k[0] in obj) && !({ temp: 'temperature', hum: 'humidity' }[k] in obj));
    if (miss.length) warns.push(`thiếu khoá ${miss.join(', ')}`);
  } else if (!isJson && FIELD[sub]) {
    const w = setField(n, FIELD[sub], text, ts);
    if (w) warns.push(w);
  } else if (!isJson) {
    warns.push(sub ? `topic lạ "${sub}"` : 'nội dung phải là JSON, ví dụ {"nhom":"nhom01","temp":26.4,"hum":61.2,"led":0,"btn":0}');
  }
  n.seen = ts;
  n.msgs++;
  const entry = addLog(ts, topic, text, warns.join('; ') || null);
  if (entry.warn) console.log(`[${name}] ${topic} = ${text}  !! ${entry.warn}`);
  broadcast({ kind: 'node', node: n, entry });
});

// ===== Web =====
const sseClients = new Set();
function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) res.write(line);
}

// IP LAN của máy chạy broker: SV cần IP này để cấu hình ESP32
function lanIp() {
  for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
    if (!/^(en|eth|wlan)/.test(ifname)) continue;
    for (const a of addrs) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}
const info = () => ({ broker: brokerOk, ip: lanIp(), port: 1883, base: BASE });

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1024) req.destroy(); });
    req.on('end', () => resolve(s));
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ kind: 'snapshot', info: info(), nodes: [...nodes.values()], log })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (url.pathname === '/api/info') return json(res, 200, info());
  if (url.pathname === '/api/nodes') return json(res, 200, [...nodes.values()]);

  // POST /api/led/<nhóm>  body {"v":1|0}  -> vju/iot/<nhóm>/output  "on" / "off"
  if (parts[0] === 'api' && parts[1] === 'led' && parts[2] && req.method === 'POST') {
    let v;
    try { v = JSON.parse(await readBody(req)).v; } catch { return json(res, 400, { ok: false, err: 'body khong phai JSON' }); }
    if (!brokerOk) return json(res, 503, { ok: false, err: 'chua ket noi broker' });
    if (!NAME_RE.test(parts[2])) return json(res, 400, { ok: false });
    const topic = `${BASE}/${parts[2]}/output`, payload = v ? 'on' : 'off';
    client.publish(topic, payload, { qos: 0 });
    console.log(`[${parts[2]}] <- output ${payload}`);
    // Theo dõi phản hồi: chờ kit gửi lại "led" khớp lệnh, quá CMD_WAIT_MS thì báo chưa phản hồi
    const n = node(parts[2]), cmd = { v: v ? 1 : 0, payload, topic, ts: Date.now(), state: 'wait' };
    n.cmd = cmd;
    broadcast({ kind: 'node', node: n, entry: addLog(cmd.ts, topic, payload, null) });
    setTimeout(() => {
      if (n.cmd !== cmd || cmd.state !== 'wait') return;
      cmd.state = 'timeout';
      broadcast({ kind: 'node', node: n, entry: addLog(Date.now(), topic, payload, `kit chưa phản hồi sau ${CMD_WAIT_MS / 1000} s`) });
    }, CMD_WAIT_MS);
    return json(res, 200, { ok: true, topic, payload });
  }
  // POST /api/forget/<nhóm>  -> bỏ nhóm khỏi màn hình (vd tên đặt nhầm)
  if (parts[0] === 'api' && parts[1] === 'forget' && parts[2] && req.method === 'POST') {
    nodes.delete(parts[2]);
    broadcast({ kind: 'forget', name: parts[2] });
    return json(res, 200, { ok: true });
  }
  // GET /api/csv/<nhóm>?date=YYYY-MM-DD
  if (parts[0] === 'api' && parts[1] === 'csv' && parts[2]) {
    const date = url.searchParams.get('date') || day();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !NAME_RE.test(parts[2])) return json(res, 400, { ok: false });
    const f = csvFile(parts[2], date);
    if (!fs.existsSync(f)) return json(res, 404, { ok: false, err: 'chua co du lieu' });
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${parts[2]}-${date}.csv"` });
    return fs.createReadStream(f).pipe(res);
  }

  // File tĩnh: public/* (code mẫu ../sv_mau là đáp án của giảng viên, không phục vụ qua web)
  const base = path.join(DIR, 'public');
  const file = path.join(base, ...(parts.length ? parts : ['index.html']));
  if (file.startsWith(base + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  json(res, 404, { ok: false });
});

// Hiện sẵn thẻ nhom01..nhomNN (mặc định 12) để thấy ngay nhóm nào chưa kết nối
const GROUPS = Number(process.env.GROUPS || 12);
for (let i = 1; i <= GROUPS; i++) node(`nhom${String(i).padStart(2, '0')}`);
// Nạp lại các nhóm đã có dữ liệu hôm nay để màn hình không trống khi vừa mở app
const todayDir = path.join(DIR, 'data', day());
if (fs.existsSync(todayDir)) for (const f of fs.readdirSync(todayDir)) if (f.endsWith('.csv')) node(f.slice(0, -4));

server.listen(PORT, () => {
  const ip = lanIp();
  console.log(`Dashboard: http://localhost:${PORT}   (SV cùng mạng: http://${ip}:${PORT})`);
  console.log(`Broker cho SV: ${ip}:1883, topic ${BASE}/<nhomXX>/...`);
});
