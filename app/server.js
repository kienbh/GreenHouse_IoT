// App nhà kính chạy local trên PC: MQTT client nối tới broker Mosquitto
//  - Đăng ký vju/nhakinh/+/{status,telemetry,event}, giữ trạng thái mới nhất của từng ESP32
//  - Ghi telemetry và sự kiện ra CSV theo ngày: data/<thiết bị>/telemetry-YYYY-MM-DD.csv
//  - Giao diện web http://localhost:PORT, đẩy dữ liệu tức thời bằng SSE, lệnh gửi qua POST -> topic cmd
import mqtt from 'mqtt';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const BASE = process.env.MQTT_BASE || 'vju/nhakinh';
const PORT = Number(process.env.PORT || 3000);
const HIST_MAX = 1440;      // số điểm giữ trong RAM cho biểu đồ (~2 giờ ở chu kỳ 5 s)
const EVT_MAX = 200;

// ===== Trạng thái từng thiết bị =====
const devices = new Map();  // tên -> { status, tele, seen, hist: [[ts, t, h]], events: [] }
function dev(name) {
  if (!devices.has(name)) {
    devices.set(name, { status: 'unknown', tele: null, seen: 0, hist: loadHistory(name), events: [] });
  }
  return devices.get(name);
}

// ===== Ghi CSV =====
const TELE_HEAD = 'time,t,h,code,ledR,ledG,ledArray,auto,th,pump_st,duty,out,rssi\n';
const EVT_HEAD = 'time,level,boot,ms,msg\n';
const today = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const csvFile = (name, kind, date = today()) => path.join(DIR, 'data', name, `${kind}-${date}.csv`);
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

// ===== MQTT =====
let brokerOk = false;
const client = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  clientId: `nhakinh-app-${process.pid}`,
  reconnectPeriod: 3000,
});

client.on('connect', () => {
  brokerOk = true;
  console.log(`MQTT: da ket noi ${MQTT_URL}`);
  client.subscribe([`${BASE}/+/status`, `${BASE}/+/telemetry`, `${BASE}/+/event`], { qos: 1 });
  broadcast({ kind: 'broker', ok: true });
});
client.on('close', () => {
  if (brokerOk) console.log('MQTT: mat ket noi broker, dang thu lai...');
  brokerOk = false;
  broadcast({ kind: 'broker', ok: false });
});
client.on('error', (e) => console.log('MQTT loi:', e.message));

client.on('message', (topic, buf) => {
  const [, , name, kind] = topic.split('/');   // vju/nhakinh/<tên>/<loại>
  const d = dev(name);
  const ts = Date.now();
  const text = buf.toString();
  d.seen = ts;
  let data = text;
  if (kind === 'status') {
    d.status = text;
    console.log(`[${name}] ${text}`);
  } else {
    try { data = JSON.parse(text); } catch { console.log(`[${name}] ${kind} khong phai JSON: ${text}`); return; }
  }
  if (kind === 'telemetry') {
    d.tele = data;
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
});

function sendCmd(name, cmd) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(cmd);
    client.publish(`${BASE}/${name}/cmd`, payload, { qos: 1 }, (err) => (err ? reject(err) : resolve(payload)));
  });
}

// ===== Web: giao diện + SSE + API =====
const sseClients = new Set();
function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) res.write(line);
}

function snapshot() {
  const out = {};
  for (const [name, d] of devices) out[name] = d;
  return { broker: brokerOk, url: MQTT_URL, base: BASE, devices: out };
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 4096) req.destroy(); });
    req.on('end', () => resolve(s));
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
               '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(DIR, 'public', 'index.html')).pipe(res);
  }
  if (url.pathname === '/stream') {        // SSE: gửi ảnh chụp đầy đủ rồi từng tin MQTT
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ kind: 'snapshot', ...snapshot() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (url.pathname === '/api/devices') return json(res, 200, snapshot());

  // POST /api/cmd/<tên>  body JSON, ví dụ {"ledR":1}
  if (parts[0] === 'api' && parts[1] === 'cmd' && parts[2] && req.method === 'POST') {
    const body = await readBody(req);
    let cmd;
    try { cmd = JSON.parse(body); } catch { return json(res, 400, { ok: false, err: 'body khong phai JSON' }); }
    if (!brokerOk) return json(res, 503, { ok: false, err: 'chua ket noi broker' });
    try {
      const payload = await sendCmd(parts[2], cmd);
      console.log(`[${parts[2]}] <- ${payload}`);
      return json(res, 200, { ok: true, sent: payload });
    } catch (e) {
      return json(res, 500, { ok: false, err: e.message });
    }
  }

  // GET /api/csv/<tên>/<telemetry|events>?date=YYYY-MM-DD  -> tải file CSV
  if (parts[0] === 'api' && parts[1] === 'csv' && parts[2] && ['telemetry', 'events'].includes(parts[3])) {
    const date = url.searchParams.get('date') || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parts[2].includes('..')) return json(res, 400, { ok: false });
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
});

// Nạp lịch sử các thiết bị đã có dữ liệu để biểu đồ không trống khi vừa mở app
const dataDir = path.join(DIR, 'data');
if (fs.existsSync(dataDir)) for (const name of fs.readdirSync(dataDir)) if (!name.startsWith('.')) dev(name);

server.listen(PORT, () => console.log(`Giao dien: http://localhost:${PORT}`));
