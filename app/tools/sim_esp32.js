// Giả lập 1 ESP32 nhà kính (sim-01) để thử broker + app khi chưa cắm board. Đây là THIẾT BỊ MÔ PHỎNG:
// mọi số đo là số tạo ngẫu nhiên, "đã áp dụng" chỉ là trạng thái trong chương trình, không chứng minh tải thật chạy.
// Cùng topic/định dạng với firmware: status (LWT), telemetry có seq, event, nhận cmd, gửi ack (Bài 6),
// khóa an toàn + lease cho lệnh tự động (Bài 7), TLS (Bài 8), bộ đệm 30 bản ghi + gửi bù + giả lập mất mạng (Bài 9).
import mqtt from 'mqtt';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MQTT_BASE || 'vju/nhakinh';
const NAME = process.env.SIM_DEVICE || 'sim-01';
const T = `${BASE}/${NAME}`;
const URL_ = process.env.MQTT_URL || 'mqtts://localhost:8883';
const CA = process.env.MQTT_CA || path.join(DIR, '..', '..', 'mqtt_broker', 'tls', 'ca.crt');
const ST = ['DUNG', 'CHAY', 'LOI'];
const BUF_N = 30, DEDUP_N = 16, FAN_LEASE_S = 90;

const s = { song: -1, t: 27, h: 60, ledR: 0, ledG: 0, ledArray: 0, auto: 0, th: 30, pst: 0, duty: 50, lim: 15, cd: 10,
            since: 0, coolUntil: 0, msg: 'Khoi dong: tai tat (DUNG)', rx: 0, boot: Math.floor(Date.now() / 1000) % 65536,
            lock: 0, fanAuto: false, leaseUntil: 0, testT: null, fault: 0, period: 5, seq: 0 };
const t0 = Date.now();
const ring = []; let dropped = 0, replayed = 0;
const seen = new Map();           // cmd_id -> trạng thái lần đầu (giữ DEDUP_N mục gần nhất)
let outageUntil = 0;

const client = mqtt.connect(URL_, {
  username: process.env.SIM_USER, password: process.env.SIM_PASS, clientId: `nhakinh-${NAME}`, keepalive: 15,
  will: { topic: `${T}/status`, payload: 'offline', qos: 1, retain: true },
  queueQoSZero: false,            // không để thư viện tự đệm: bộ đệm hữu hạn do chương trình quản lý (Bài 9)
  ...(URL_.startsWith('mqtts:') ? { ca: fs.readFileSync(CA), rejectUnauthorized: true } : {}),
});
const up = () => client.connected && Date.now() >= outageUntil;

function event(lv, msg) {
  console.log(`[${lv}] ${msg}`);
  if (up()) client.publish(`${T}/event`, JSON.stringify({ lv, boot: s.boot, ms: Date.now() - t0, msg }));
}
function setState(p, why) {
  s.msg = `${ST[s.pst]} -> ${ST[p]}: ${why}`;
  event(p === 2 ? 'E' : 'I', `B3 FSM ${s.msg}`);
  s.pst = p; s.since = Date.now();
}
const code = () => (s.fault ? 2 : 0);
const temp = () => (s.fault ? null : s.testT ?? s.t);

function fanSafety() {
  if (!s.fanAuto || !s.ledG) return;
  const why = s.lock ? 'khoa an toan' : code() ? 'loi cam bien' : s.pst === 2 ? 'may bom dang LOI'
    : Date.now() >= s.leaseUntil ? 'het han lenh tu dong (mat lien lac voi dich vu?)' : null;
  if (!why) return;
  s.ledG = 0; s.fanAuto = false;
  event('W', `B7 Node tat LED xanh (quat): ${why}`);
}

function telemetry() {
  const now = Date.now();
  s.t = Math.round((s.t + (Math.random() - 0.5) * 0.4 + (s.pst === 1 ? -0.1 : 0.02)) * 10) / 10;
  s.h = Math.round(Math.min(95, Math.max(30, s.h + (Math.random() - 0.5) * 2 + (s.pst === 1 ? 0.6 : -0.1))));
  const t = temp();
  if (s.auto && t != null) { s.ledR = t >= s.th ? 1 : t <= s.th - 1 ? 0 : s.ledR; s.ledG = s.ledR ? 0 : 1; }
  if (s.pst === 1 && now - s.since >= s.lim * 1000) {
    s.coolUntil = now + s.cd * 1000;
    setState(0, `het gio ${s.lim}s, nghi ${s.cd}s`);
  }
  fanSafety();
  const seq = ++s.seq;
  const rec = { dev: NAME, boot: s.boot, seq, up_ms: now - t0, ts: now, valid: !code(), t, h: s.fault ? null : s.h, code: code() };
  if (!up()) {                    // mất kết nối: vào bộ đệm, đầy thì bỏ bản cũ nhất
    if (ring.length === BUF_N) { ring.shift(); dropped++; }
    ring.push(rec);
    return;
  }
  client.publish(`${T}/telemetry`, JSON.stringify({
    ...rec, src: s.testT != null ? 'test' : 'sim', ledR: s.ledR, ledG: s.ledG, ledArray: s.ledArray, auto: s.auto, th: s.th, song: s.song,
    pump: { st: ST[s.pst], duty: s.duty, out: s.pst === 1 ? s.duty : 0, lim: s.lim, cd: s.cd,
            el: s.pst === 1 ? Math.floor((now - s.since) / 1000) : 0,
            cool: Math.max(0, Math.ceil((s.coolUntil - now) / 1000)), msg: s.msg },
    lock: s.lock, fan: { by: s.fanAuto ? 'auto' : 'manual', lease: s.fanAuto && s.ledG ? Math.max(0, Math.round((s.leaseUntil - now) / 1000)) : 0 },
    buf: { n: ring.length, max: BUF_N, drop: dropped, replay: replayed }, period: s.period,
    rssi: -55 - Math.floor(Math.random() * 10), up: Math.floor((now - t0) / 1000), rx: s.rx,
  }));
}
function flush() {
  while (ring.length && up()) {
    client.publish(`${T}/telemetry`, JSON.stringify({ ...ring.shift(), replay: 1 }));
    replayed++;
    if (!ring.length) event('I', `B9 Da gui bu xong, tong gui bu ${replayed}, bo ${dropped}`);
  }
}
let timer = setInterval(telemetry, s.period * 1000);

function apply(c, isAuto) {
  let rej = '';
  const R = (why) => { rej ||= why; };
  if (isAuto && s.lock) return 'dang khoa an toan';
  if (isAuto && code()) return 'loi cam bien';
  if (isAuto && s.pst === 2) return 'may bom dang LOI';
  if (isAuto && s.auto) return 'xung dot: che do tu dong tai node dang bat';
  if ('auto' in c) s.auto = +c.auto ? 1 : 0;
  if ('th' in c) s.th = +c.th;
  if (!s.auto) { if ('ledR' in c) s.ledR = +c.ledR ? 1 : 0; if ('ledG' in c) s.ledG = +c.ledG ? 1 : 0; }
  else if ('ledR' in c || 'ledG' in c) R('che do tu dong tai node dang quan ly LED R/G');
  if ('ledG' in c && !s.auto) { s.fanAuto = isAuto && !!s.ledG; if (s.fanAuto) s.leaseUntil = Date.now() + (Number(c.lease) >= 10 ? +c.lease : FAN_LEASE_S) * 1000; }
  if ('play' in c && +c.play >= 0 && +c.play <= 3) {
    s.song = +c.play; clearTimeout(s.songTimer);
    s.songTimer = setTimeout(() => { s.song = -1; telemetry(); }, s.song === 3 ? 1000 : 10000);
  }
  if ('stop' in c) { s.song = -1; clearTimeout(s.songTimer); }
  if ('ledArray' in c) s.ledArray = Math.max(0, Math.min(2, +c.ledArray | 0));
  for (const [k, lo, hi] of [['duty', 1, 100], ['lim', 3, 300], ['cd', 0, 600]])
    if (k in c) { if (Number.isInteger(c[k]) && c[k] >= lo && c[k] <= hi) s[k] = c[k]; else R(`${k} sai`); }
  if ('lock' in c) { s.lock = +c.lock ? 1 : 0; event(s.lock ? 'W' : 'I', `B7 ${s.lock ? 'Bat' : 'Mo'} khoa an toan`); if (s.lock && s.pst === 1) setState(0, 'khoa an toan'); fanSafety(); }
  if ('testT' in c) { s.testT = c.testT == null ? null : +c.testT; event('W', `B7 Du lieu thu: ${s.testT == null ? 'tat' : 't=' + s.testT + ' C'}`); }
  if ('testFault' in c) s.fault = +c.testFault ? 1 : 0;
  if ('period' in c) { if (Number.isInteger(c.period) && c.period >= 1 && c.period <= 60) { s.period = c.period; clearInterval(timer); timer = setInterval(telemetry, s.period * 1000); } else R('period phai 1-60 s'); }
  const start = c.cmd === 'start' || c.pump === 1, stop = c.cmd === 'stop' || c.pump === 0;
  if (stop && s.pst === 1) setState(0, 'lenh dung');
  if (start) {
    const left = Math.ceil((s.coolUntil - Date.now()) / 1000);
    const why = s.lock ? 'dang khoa an toan' : s.pst === 1 ? 'dang CHAY, khong gia han gio' : s.pst === 2 ? 'dang LOI' : left > 0 ? `dang nghi, con ${left}s` : '';
    if (why) { event('W', `B3 Giu ${ST[s.pst]}, tu choi: ${why}`); R(why); }
    else setState(1, `lenh chay, duty ${s.duty}%, toi da ${s.lim}s`);
  }
  if ('outage' in c) {
    const n = +c.outage;
    if (!(n >= 5 && n <= 600)) R('outage phai 5-600 s');
    else setTimeout(() => outage(n, c.mode === 'clean'), 300);   // để ack kịp đi trước khi ngắt
  }
  return rej;
}

// Bài 9: clean = gửi offline + DISCONNECT (không có LWT); mặc định = đóng socket đột ngột (broker phát LWT)
function outage(sec, clean) {
  event('W', `B9 Gia lap mat mang ${sec}s (${clean ? 'ngat co chu dich' : 'dong ket noi dot ngot'})`);
  outageUntil = Date.now() + sec * 1000;
  client.options.reconnectPeriod = sec * 1000;
  if (clean) client.publish(`${T}/status`, 'offline', { qos: 1, retain: true }, () => client.end(false, () => setTimeout(() => client.reconnect(), sec * 1000)));
  else client.stream.destroy();
  setTimeout(() => { client.options.reconnectPeriod = 3000; }, sec * 1000 + 100);
}

client.on('connect', () => {
  console.log(`Gia lap ${NAME}: da ket noi ${URL_}, topic ${T}/#`);
  client.publish(`${T}/status`, 'online', { qos: 1, retain: true });
  client.subscribe(`${T}/cmd`, { qos: 1 });
  event('I', `MQTT da ket noi (gia lap), topic ${T}, dem ${ring.length} ban ghi cho gui bu`);
  flush();
  telemetry();
});

client.on('message', (_topic, buf) => {
  if (!up()) return;
  s.rx++;
  let c;
  try { c = JSON.parse(buf); } catch { event('W', `B3 Giu ${ST[s.pst]}, tu choi: lenh sai '${buf}'`); return telemetry(); }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return;
  console.log('<-', JSON.stringify(c));
  const id = typeof c.cmd_id === 'string' ? c.cmd_id.replace(/[^\w.-]/g, '').slice(0, 40) : '';
  const isAuto = c.src === 'auto';
  const ack = (status, reason = '') => id && client.publish(`${T}/ack`, JSON.stringify({ cmd_id: id, status, reason, boot: s.boot, up_ms: Date.now() - t0,
    state: { ledR: s.ledR, ledG: s.ledG, ledArray: s.ledArray, pump: ST[s.pst], lock: s.lock }, sim: 1 }));
  if (id && seen.has(id)) { event('W', `B6 Lenh trung ${id} (lan dau: ${seen.get(id)}), khong thuc hien lai`); return ack('duplicate', seen.get(id)); }
  if (process.env.SIM_DROP_ACK === '1') console.log('(SIM_DROP_ACK: bo qua ack de thu qua han)');
  const rej = apply(c, isAuto);
  if (id) { seen.set(id, rej ? 'rejected' : 'applied'); if (seen.size > DEDUP_N) seen.delete(seen.keys().next().value); }
  if (process.env.SIM_DROP_ACK !== '1') ack(rej ? 'rejected' : 'applied', rej);
  telemetry();
});

client.on('error', (e) => console.log('MQTT loi:', e.message));
