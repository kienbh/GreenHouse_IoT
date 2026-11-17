// Chạy các ca thử Bài 6 và Bài 7 qua API thật của app (đăng nhập theo vai như người dùng).
//   node tools/lab-tests.js bai6 [thiết-bị]   (mặc định sim-01)
//   node tools/lab-tests.js bai7 [thiết-bị]
// Kết quả in dạng bảng Markdown và ghi vào ../docs/ket-qua/<bai>-<thiết-bị>-<ngày giờ>.md
// Ghi rõ môi trường: sim-01 là thiết bị MÔ PHỎNG trên PC; esp32-01 là ESP32 thật (LED trên bo, dữ liệu thử testT).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.API || 'http://localhost:3000';
const [which = 'bai6', DEV = 'sim-01'] = process.argv.slice(2);
const pass = Object.fromEntries(fs.readFileSync(path.join(DIR, 'data', 'accounts-app.local'), 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([u, , p]) => [u, p]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (s = '') => { console.log(s); out.push(s); };

async function session(user) {
  const r = await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, pass: pass[user] }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  if (!r.ok) throw new Error(`dang nhap ${user} that bai: ${r.status}`);
  const call = async (method, p, body) => {
    const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { user, cmd: (c, dev = DEV) => call('POST', `/api/cmd/${dev}`, c), get: (p) => call('GET', p), post: (p, b) => call('POST', p, b) };
}
const anon = { cmd: async (c) => { const r = await fetch(`${API}/api/cmd/${DEV}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }); return { status: r.status, body: await r.json() }; } };

// Chờ lệnh ra khỏi trạng thái pending (ack hoặc quá hạn), trả bản ghi lệnh cuối
async function settle(s, id, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const c = (await s.get(`/api/commands/${DEV}`)).body.commands.find((x) => x.cmd_id === id);
    if (c && c.status !== 'pending') return c;
    if (Date.now() > end) return c;
    await sleep(250);
  }
}
async function tele(s) { return (await s.get('/api/devices')).body.devices[DEV]?.tele; }
async function waitTele(s, pred, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { const t = await tele(s); if (t && pred(t)) return t; if (Date.now() > end) return t; await sleep(500); }
}
const row = (...c) => log(`| ${c.join(' | ')} |`);
const stamp = () => new Date().toLocaleString('sv-SE').replace(' ', '_').replace(/:/g, '');

async function bai6() {
  const op = await session('van-hanh'), viewer = await session('xem'), admin = await session('quan-tri');
  const env = DEV.startsWith('sim') ? 'thiết bị MÔ PHỎNG trên PC (tools/sim_esp32.js)' : 'ESP32 thật, LED trên bo/nhà kính';
  log(`## Bài 6 – Ca thử vòng lệnh · ${DEV} (${env}) · ${new Date().toLocaleString('vi-VN')}`);
  log();
  row('Ca', 'Tài khoản', 'Lệnh', 'HTTP', 'cmd_id', 'Trạng thái cuối', 'Ack/độ trễ', 'Ghi chú');
  row('---', '---', '---', '---', '---', '---', '---', '---');
  const t0 = await tele(op);
  // 1 hợp lệ
  let r = await op.cmd({ ledR: t0?.ledR ? 0 : 1 });
  let c = await settle(op, r.body.cmd.cmd_id);
  row('1 Hợp lệ', 'van-hanh (operator)', `{"ledR":${t0?.ledR ? 0 : 1}}`, r.status, c.cmd_id, c.status, `${c.latency_ms} ms`, `ack: ${c.ack_payload}`);
  // 2 mất xác nhận: thiết bị không tồn tại/ngoại tuyến -> broker nhận nhưng không ai ack
  r = await op.cmd({ ledR: 1 }, 'ghost-01');
  c = (await op.get('/api/commands/ghost-01')).body.commands[0];
  await sleep(5600);
  c = (await op.get('/api/commands/ghost-01')).body.commands.find((x) => x.cmd_id === c.cmd_id);
  row('2 Mất xác nhận', 'van-hanh', '{"ledR":1} → ghost-01 (không có node)', r.status, c.cmd_id, c.status, '-', `broker đã nhận lúc ${c.sent_at}; ${c.reason}`);
  // 3 sai quyền
  r = await viewer.cmd({ ledR: 1 });
  row('3a Sai quyền', 'xem (viewer)', '{"ledR":1}', r.status, '-', 'không tạo lệnh', '-', r.body.err);
  r = await op.cmd({ lim: 20 });
  row('3b Sai quyền', 'van-hanh (operator)', '{"lim":20} (cấu hình)', r.status, '-', 'không tạo lệnh', '-', r.body.err);
  r = await anon.cmd({ ledR: 1 });
  row('3c Chưa đăng nhập', '-', '{"ledR":1}', r.status, '-', 'không tạo lệnh', '-', r.body.err);
  // 4 gửi lại cùng mã lệnh. Trên thiết bị thật chỉ chạy bơm khi ALLOW_PUMP=1 (có người giám sát tải thật)
  if (DEV.startsWith('sim') || process.env.ALLOW_PUMP === '1') {
    const before = await waitTele(op, (t) => t.pump?.st === 'DUNG' && !(t.pump.cool > 0), 30000);
    r = await op.cmd({ cmd: 'start' });
    c = await settle(op, r.body.cmd.cmd_id);
    row('4a Chạy bơm', 'van-hanh', '{"cmd":"start"}', r.status, c.cmd_id, c.status, `${c.latency_ms} ms`, `trước đó bơm ${before?.pump?.st}`);
    const el1 = (await waitTele(op, (t) => t.pump?.st === 'CHAY' && t.pump.el >= 3))?.pump?.el;
    const r2 = await op.post(`/api/cmd/${DEV}`, { resend: c.cmd_id });
    const c2 = await settle(op, c.cmd_id);
    const t2 = await waitTele(op, (t) => t.pump?.el > el1, 8000);
    row('4b Gửi lại cùng cmd_id', 'van-hanh', `{"resend":"${c.cmd_id}"}`, r2.status, c2.cmd_id, c2.status, `${c2.latency_ms} ms`,
        `node báo trùng, không chạy lại; thời gian chạy el=${el1}s trước → el=${t2?.pump?.el}s sau (không về 0), giới hạn ${t2?.pump?.lim}s giữ nguyên`);
    r = await op.cmd({ cmd: 'stop' });
    c = await settle(op, r.body.cmd.cmd_id);
    row('4c Dừng bơm', 'van-hanh', '{"cmd":"stop"}', r.status, c.cmd_id, c.status, `${c.latency_ms} ms`, '');
  } else {
    const t1 = await tele(op), next = t1?.ledArray === 2 ? 0 : 2;
    r = await op.cmd({ ledArray: next });
    c = await settle(op, r.body.cmd.cmd_id);
    row('4a Lệnh dải LED', 'van-hanh', `{"ledArray":${next}}`, r.status, c.cmd_id, c.status, `${c.latency_ms} ms`, 'bơm thật không chạy trong ca thử tự động (ALLOW_PUMP chưa bật)');
    const r2 = await op.post(`/api/cmd/${DEV}`, { resend: c.cmd_id });
    const c2 = await settle(op, c.cmd_id);
    const rx = (await tele(op))?.rx;
    row('4b Gửi lại cùng cmd_id', 'van-hanh', `{"resend":"${c.cmd_id}"}`, r2.status, c2.cmd_id, c2.status, `${c2.latency_ms} ms`, `node nhận (rx=${rx}) nhưng báo trùng: ${c2.reason}`);
    r = await op.cmd({ ledArray: t1?.ledArray ?? 0 });
    await settle(op, r.body.cmd.cmd_id);
  }
  const audit = (await admin.get('/api/audit?n=12')).body.audit;
  log();
  log('### Audit log (12 dòng mới nhất, admin xem)');
  log();
  row('Thời điểm', 'Tài khoản', 'Vai', 'Hành động', 'Thiết bị', 'cmd_id', 'Kết quả');
  row('---', '---', '---', '---', '---', '---', '---');
  for (const a of audit) row(a.at, a.user ?? '-', a.role ?? '-', a.action, a.dev ?? '-', a.cmd_id ?? '-', a.result);
}

async function bai7() {
  const op = await session('van-hanh'), admin = await session('quan-tri');
  const env = DEV.startsWith('sim') ? 'thiết bị MÔ PHỎNG' : 'ESP32 thật, LED xanh trên bo giả lập quạt';
  log(`## Bài 7 – Ca thử luật thông gió (bật ≥ 30 °C, tắt ≤ 28 °C) · ${DEV} (${env}) · ${new Date().toLocaleString('vi-VN')}`);
  log('Nhiệt độ ở các ca dưới đây là DỮ LIỆU THỬ do chương trình đưa vào (lệnh testT, telemetry src="test"), không phải số đo thật.');
  log();
  const set = async (c) => { const r = await admin.cmd(c); return settle(admin, r.body.cmd.cmd_id); };
  await op.post(`/api/mode/${DEV}`, { mode: 'manual' });
  await set({ auto: 0, period: 2 });
  await set({ lock: 0 });
  await op.cmd({ ledG: 0 });
  await op.post(`/api/mode/${DEV}`, { mode: 'auto' });
  row('Ca', 'Đầu vào', 'LED xanh trước', 'Mong đợi', 'LED xanh sau', 'Quyết định của luật (rule_log)', 'Đạt');
  row('---', '---', '---', '---', '---', '---', '---');
  // Dòng nhật ký quyết định của bước: ưu tiên on/off/skip phát sinh từ lúc bắt đầu bước, không thì dòng mới nhất
  const lastRule = async (since = 0) => {
    const logs = (await op.get(`/api/rules/${DEV}`)).body.log.filter((l) => l.decision !== 'mode');
    return logs.find((l) => Date.parse(l.at) >= since && ['on', 'off', 'skip'].includes(l.decision)) || logs[0];
  };
  async function step(name, input, expectOn, waitMs = 12000) {
    const before = (await tele(op))?.ledG, since = Date.now();
    await set(input);
    const t = await waitTele(op, (x) => !!x.ledG === expectOn && (input.testT === undefined || x.t === input.testT), waitMs);
    await sleep(600);
    const l = await lastRule(since);
    row(name, JSON.stringify(input), before ? 'bật' : 'tắt', expectOn ? 'bật' : 'tắt', t?.ledG ? 'bật' : 'tắt', `${l?.decision}: ${l?.reason}`, !!t?.ledG === expectOn ? '✔' : '✘');
  }
  await step('1 Dưới ngưỡng', { testT: 27 }, false);
  await step('2 Chạm ngưỡng bật', { testT: 30 }, true);
  await step('3 Trong dải trễ', { testT: 29 }, true);
  await step('4 Chạm ngưỡng tắt', { testT: 28 }, false, 16000);
  await step('5 Bật lại', { testT: 31 }, true, 16000);
  await step('6 Lỗi cảm biến khi đang bật', { testFault: 1 }, false);
  await set({ testFault: 0 });
  await step('7 Hết lỗi, nóng lại', { testT: 31 }, true, 16000);
  // khóa an toàn
  const lk = await op.cmd({ lock: 1 });
  const lkc = await settle(op, lk.body.cmd.cmd_id);
  const s8 = Date.now();
  const tl = await waitTele(op, (x) => x.lock && !x.ledG);
  await sleep(2500);
  const l8 = await lastRule(s8);
  row('8 Bật khóa an toàn (van-hanh)', '{"lock":1}, t=31', 'bật', 'tắt, luật không bật lại', tl?.ledG ? 'bật' : 'tắt', `${lkc.status}; luật: ${l8?.decision}: ${l8?.reason}`, !tl?.ledG ? '✔' : '✘');
  const un = await op.cmd({ lock: 0 });
  row('9 Mở khóa bằng van-hanh', '{"lock":0}', 'tắt', 'bị từ chối (403)', '-', `HTTP ${un.status}: ${un.body.err}`, un.status === 403 ? '✔' : '✘');
  const man = await op.cmd({ ledG: 1 });
  row('10 Lệnh tay LED xanh khi đang tự động', '{"ledG":1}', 'tắt', 'bị từ chối (409)', '-', `HTTP ${man.status}: ${man.body.err}`, man.status === 409 ? '✔' : '✘');
  await set({ lock: 0 });
  await step('11 Admin mở khóa, vẫn 31 °C', { lock: 0 }, true, 16000);
  // chuyển thủ công: không phát lại lệnh cũ, đầu ra giữ nguyên
  const nCmd = (await op.get(`/api/commands/${DEV}`)).body.commands.length;
  await op.post(`/api/mode/${DEV}`, { mode: 'manual' });
  await set({ testT: 27 });
  await sleep(6000);
  const tm = await tele(op);
  const autoCmds = (await op.get(`/api/commands/${DEV}`)).body.commands.slice(0, 30).filter((c) => c.src === 'auto' && Date.parse(c.created_at) > Date.now() - 6500);
  row('12 Chuyển thủ công, t=27', '{"mode":"manual"} + {"testT":27}', 'bật', 'giữ bật, luật không gửi lệnh', tm?.ledG ? 'bật' : 'tắt', `${autoCmds.length} lệnh tự động trong 6 s (tổng lệnh ${nCmd})`, tm?.ledG && !autoCmds.length ? '✔' : '✘');
  await op.cmd({ ledG: 0 });
  await set({ testT: null, period: 5 });
  log();
  log('### Nhật ký luật (20 dòng mới nhất)');
  log();
  row('Thời điểm', 'Chế độ', 't (°C)', 'Tuổi dữ liệu', 'LED xanh', 'Quyết định', 'Lý do', 'cmd_id', 'Dữ liệu thử');
  row('---', '---', '---', '---', '---', '---', '---', '---', '---');
  for (const l of (await op.get(`/api/rules/${DEV}`)).body.log.slice(0, 20)) row(l.at, l.mode, l.t ?? '-', l.data_age_ms == null ? '-' : `${l.data_age_ms} ms`, l.fan ?? '-', l.decision, l.reason, l.cmd_id ?? '-', l.test ? 'có' : '');
}

await (which === 'bai7' ? bai7() : bai6());
const dir = path.join(DIR, '..', 'docs', 'ket-qua');
fs.mkdirSync(dir, { recursive: true });
const f = path.join(dir, `${which}-${DEV}-${stamp()}.md`);
fs.writeFileSync(f, out.join('\n') + '\n');
console.log(`\nDa ghi ${path.relative(path.join(DIR, '..'), f)}`);
