// Giả lập 1 ESP32 nhà kính để thử broker + app khi chưa cắm board
// Cùng topic và định dạng JSON với firmware: status (Last Will), telemetry mỗi 5 s, event, nhận cmd
import mqtt from 'mqtt';

const BASE = process.env.MQTT_BASE || 'vju/nhakinh';
const NAME = process.env.SIM_DEVICE || 'sim-01';
const T = `${BASE}/${NAME}`;
const ST = ['DUNG', 'CHAY', 'LOI'];

const s = { t: 27, h: 60, ledR: 0, ledG: 0, ledArray: 0, auto: 0, th: 30, pst: 0, duty: 50, lim: 15, cd: 10,
            since: 0, coolUntil: 0, msg: 'Khoi dong: tai tat (DUNG)', rx: 0, boot: 1 };
const t0 = Date.now();

const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883', {
  username: process.env.SIM_USER, password: process.env.SIM_PASS, clientId: `nhakinh-${NAME}`,
  will: { topic: `${T}/status`, payload: 'offline', qos: 1, retain: true },
});

function event(lv, msg) {
  console.log(`[${lv}] ${msg}`);
  client.publish(`${T}/event`, JSON.stringify({ lv, boot: s.boot, ms: Date.now() - t0, msg }));
}

function setState(p, why) {
  s.msg = `${ST[s.pst]} -> ${ST[p]}: ${why}`;
  event(p === 2 ? 'E' : 'I', `B3 FSM ${s.msg}`);
  s.pst = p; s.since = Date.now();
}

function telemetry() {
  const now = Date.now();
  s.t = Math.round((s.t + (Math.random() - 0.5) * 0.4 + (s.pst === 1 ? -0.1 : 0.02)) * 10) / 10;
  s.h = Math.round(Math.min(95, Math.max(30, s.h + (Math.random() - 0.5) * 2 + (s.pst === 1 ? 0.6 : -0.1))));
  if (s.auto) { s.ledR = s.t >= s.th ? 1 : s.t <= s.th - 1 ? 0 : s.ledR; s.ledG = s.ledR ? 0 : 1; }
  if (s.pst === 1 && now - s.since >= s.lim * 1000) {
    s.coolUntil = now + s.cd * 1000;
    setState(0, `het gio ${s.lim}s, nghi ${s.cd}s`);
  }
  client.publish(`${T}/telemetry`, JSON.stringify({
    t: s.t, h: s.h, code: 0, ledR: s.ledR, ledG: s.ledG, ledArray: s.ledArray, auto: s.auto, th: s.th, song: -1,
    pump: { st: ST[s.pst], duty: s.duty, out: s.pst === 1 ? s.duty : 0, lim: s.lim, cd: s.cd,
            el: s.pst === 1 ? Math.floor((now - s.since) / 1000) : 0,
            cool: Math.max(0, Math.ceil((s.coolUntil - now) / 1000)), msg: s.msg },
    rssi: -55 - Math.floor(Math.random() * 10), up: Math.floor((now - t0) / 1000), boot: s.boot, rx: s.rx,
  }));
}

client.on('connect', () => {
  console.log(`Gia lap ${NAME}: da ket noi, topic ${T}/#`);
  client.publish(`${T}/status`, 'online', { qos: 1, retain: true });
  client.subscribe(`${T}/cmd`, { qos: 1 });
  event('I', `MQTT da ket noi (gia lap), topic ${T}`);
  telemetry();
});

client.on('message', (_topic, buf) => {
  s.rx++;
  let c;
  try { c = JSON.parse(buf); } catch { event('W', `B3 Giu ${ST[s.pst]}, tu choi: lenh sai '${buf}'`); return telemetry(); }
  console.log('<-', JSON.stringify(c));
  if ('auto' in c) s.auto = +c.auto ? 1 : 0;
  if ('th' in c) s.th = +c.th;
  if (!s.auto) { if ('ledR' in c) s.ledR = +c.ledR ? 1 : 0; if ('ledG' in c) s.ledG = +c.ledG ? 1 : 0; }
  if ('ledArray' in c) s.ledArray = Math.max(0, Math.min(2, +c.ledArray | 0));
  for (const [k, lo, hi] of [['duty', 1, 100], ['lim', 3, 300], ['cd', 0, 600]])
    if (k in c && Number.isInteger(c[k]) && c[k] >= lo && c[k] <= hi) s[k] = c[k];
  const start = c.cmd === 'start' || c.pump === 1, stop = c.cmd === 'stop' || c.pump === 0;
  if (stop && s.pst === 1) setState(0, 'lenh dung');
  if (start) {
    const left = Math.ceil((s.coolUntil - Date.now()) / 1000);
    if (s.pst === 1) event('W', 'B3 Giu CHAY, tu choi: dang CHAY, khong gia han gio');
    else if (left > 0) event('W', `B3 Giu DUNG, tu choi: dang nghi, con ${left}s`);
    else setState(1, `lenh chay, duty ${s.duty}%, toi da ${s.lim}s`);
  }
  telemetry();
});

client.on('error', (e) => console.log('MQTT loi:', e.message));
setInterval(telemetry, 5000);
