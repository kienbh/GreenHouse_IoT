// Bài 9: thí nghiệm mất mạng có chủ đích qua API (tài khoản quản trị), đối chiếu theo mã bản ghi.
//   node tools/outage-test.js <thiết-bị> <giây> <wifi|clean> [chu-kỳ-giây=2]
// wifi : node ngắt mạng đột ngột (ESP32: tắt WiFi; sim: đóng socket) – không gửi DISCONNECT
// clean: node tự gửi "offline" rồi DISCONNECT có chủ đích
// Ghi kết quả vào ../docs/ket-qua/bai9-<thiết-bị>-<chế độ>-<giây>s-<thời điểm>.md
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { seqReport } from './seq-report.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.API || 'http://localhost:3000';
const [DEV = 'sim-01', SEC = '20', MODE = 'wifi', PERIOD = '2'] = process.argv.slice(2);
const pass = Object.fromEntries(fs.readFileSync(path.join(DIR, 'data', 'accounts-app.local'), 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([u, , p]) => [u, p]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'quan-tri', pass: pass['quan-tri'] }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const call = async (p, body) => (await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) })).json();
const tele = async () => (await call('/api/devices')).devices[DEV]?.tele;
const db = new Database(path.join(DIR, 'data', 'mqtt.sqlite'), { readonly: true });
const statusRows = (from) => db.prepare(`SELECT received_at, CAST(payload AS TEXT) p, retain FROM mqtt_messages WHERE topic = ? AND received_at >= ? ORDER BY id`).all(`vju/nhakinh/${DEV}/status`, from);
const out = []; const log = (s = '') => { console.log(s); out.push(s); };

await call(`/api/cmd/${DEV}`, { period: +PERIOD });
await sleep(+PERIOD * 1000 * 4);                       // vài bản ghi trước khi ngắt để có mốc seq
const from = new Date().toISOString();
const before = await tele();
const t0 = Date.now();
const r = await call(`/api/cmd/${DEV}`, { outage: +SEC, mode: MODE });
console.log(`Gui lenh outage ${SEC}s (${MODE}) ${r.cmd?.cmd_id}, cho node mat mang va noi lai...`);
// chờ: thời gian mất mạng + nối lại + gửi bù xong (buf.n = 0) + 3 chu kỳ
await sleep(+SEC * 1000);
let after;
for (let i = 0; i < 90; i++) {
  after = await tele();
  if (after && Date.parse(after.ts ?? 0) && after.up_ms && after.buf?.n === 0 && after.seq > (before?.seq ?? 0) + 2) break;
  await sleep(1000);
}
await sleep(+PERIOD * 1000 * 3);
const to = new Date().toISOString();
const rep = seqReport(db, DEV, from, to).find((b) => b.boot === before?.boot) || {};
const st = statusRows(from).map((s) => ({ ...s, t: ((Date.parse(s.received_at) - t0) / 1000).toFixed(1) }));
const offline = st.find((s) => s.p === 'offline'), online = st.find((s) => s.p === 'online' && (!offline || s.received_at > offline.received_at));

log(`## Bài 9 – Mất mạng ${SEC} s (${MODE === 'clean' ? 'ngắt có chủ đích' : 'ngắt đột ngột'}) · ${DEV} · ${new Date(t0).toLocaleString('vi-VN')}`);
log(`Môi trường: ${DEV.startsWith('sim') ? 'thiết bị mô phỏng trên PC' : 'ESP32 thật, broker Mosquitto TLS trên PC'}; chu kỳ ghi ${PERIOD} s; bộ đệm ${before?.buf?.max ?? '?'} bản ghi, đầy thì bỏ bản cũ nhất; keepalive 15 s.`);
log();
log('| Chỉ số | Giá trị |');
log('| --- | --- |');
log(`| Dải seq trong cửa sổ đối chiếu (boot ${rep.boot}) | ${rep.seq_from} – ${rep.seq_to} |`);
log(`| Bản ghi phát sinh (theo dải seq) | ${rep.generated} |`);
log(`| Nhận duy nhất | ${rep.received_unique} |`);
log(`| Mất | ${rep.lost}${rep.gaps?.length ? ` (seq ${rep.gaps.join(', ')})` : ''} |`);
log(`| Trùng | ${rep.duplicates} |`);
log(`| Gửi bù (replay=1) nhận được | ${rep.replayed} |`);
log(`| Bộ đếm tại node sau thí nghiệm | đệm ${after?.buf?.n}, bỏ cộng dồn ${after?.buf?.drop}, gửi bù cộng dồn ${after?.buf?.replay} |`);
log(`| Broker đăng "offline" | ${offline ? `sau ${offline.t} s${MODE === 'clean' ? ' (node tự gửi trước DISCONNECT)' : ' (Last Will do broker phát)'}` : 'KHÔNG thấy trong cửa sổ'} |`);
log(`| Node "online" lại | ${online ? `sau ${online.t} s` : '-'} |`);
log();
log('Các bản tin status trong cửa sổ:');
log();
for (const s of st) log(`- +${s.t} s · ${s.p} · retain=${s.retain}`);
await call(`/api/cmd/${DEV}`, { period: 5 });
const dir = path.join(DIR, '..', 'docs', 'ket-qua');
fs.mkdirSync(dir, { recursive: true });
const f = path.join(dir, `bai9-${DEV}-${MODE}-${SEC}s-${new Date(t0).toLocaleString('sv-SE').replace(' ', '_').replace(/:/g, '')}.md`);
fs.writeFileSync(f, out.join('\n') + '\n');
console.log(`\nDa ghi ${path.relative(path.join(DIR, '..'), f)}`);
