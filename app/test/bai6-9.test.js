// Kiểm thử cách ly cho Bài 6-9: luật tự động, phân quyền, vòng lệnh ack/timeout/trùng, đối chiếu seq.
// Dùng broker giả trên localhost và thư mục tạm; không gửi lệnh tới ESP32 thật.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import mqttPacket from 'mqtt-packet';
import { fileURLToPath } from 'node:url';
import { evaluate, commandFor, RULE } from '../rules.js';
import { can, actionFor, hashPassword, verifyPassword, createAuth } from '../auth.js';
import { seqReport } from '../tools/seq-report.js';
import { openMessageStore } from '../mqtt-store.js';

const APP = fileURLToPath(new URL('..', import.meta.url));
const fresh = (t, extra = {}) => ({ t, h: 60, code: 0, valid: true, ledG: 0, auto: 0, lock: 0, pump: { st: 'DUNG' }, fan: { by: 'manual' }, ...extra });
const ctx = (extra = {}) => ({ mode: 'auto', now: 100000, ...extra });

test('Bài 7: dải trễ 30/28 – bật, giữ, tắt theo chuỗi 27, 30, 29, 28', () => {
  let on = 0;
  const seen = [];
  for (const t of [27, 30, 29, 28]) {
    const r = evaluate(fresh(t, { ledG: on }), 99000, ctx());
    if (r.decision === 'on') on = 1;
    if (r.decision === 'off') on = 0;
    seen.push([t, r.decision, on]);
  }
  assert.deepEqual(seen, [[27, 'hold', 0], [30, 'on', 1], [29, 'hold', 1], [28, 'off', 0]]);
  assert.deepEqual(commandFor('on'), { ledG: 1, src: 'auto', lease: RULE.leaseS });
  assert.deepEqual(commandFor('off'), { ledG: 0, src: 'auto' });
  assert.equal(commandFor('hold'), null);
});

test('Bài 7: dao động quanh ngưỡng không bật/tắt liên tục (dải trễ + khoảng cách tối thiểu)', () => {
  const r1 = evaluate(fresh(30.2, { ledG: 1, fan: { by: 'auto' } }), 99000, ctx({ lastOnAt: 99000 }));
  const r2 = evaluate(fresh(29.8, { ledG: 1, fan: { by: 'auto' } }), 99000, ctx({ lastOnAt: 99000 }));
  assert.equal(r1.decision, 'hold'); assert.equal(r2.decision, 'hold');
  const r3 = evaluate(fresh(27, { ledG: 1 }), 99000, ctx({ lastCmdAt: 95000 }));
  assert.equal(r3.decision, 'hold', 'chưa đủ 10 s từ lệnh trước');
  assert.match(r3.reason, /cho du 10 s/);
});

test('Bài 7: không ra quyết định khi khóa, lỗi cảm biến, dữ liệu cũ, xung đột, chế độ thủ công', () => {
  const cases = [
    [fresh(35, { lock: 1 }), 99000, ctx(), /khoa an toan/],
    [fresh(null, { code: 2, valid: false }), 99000, ctx(), /loi cam bien/],
    [fresh(35), 100000 - RULE.staleMs - 1, ctx(), /qua cu/],
    [fresh(35, { auto: 1 }), 99000, ctx(), /xung dot/],
    [fresh(35, { pump: { st: 'LOI' } }), 99000, ctx(), /LOI/],
    [fresh(35), 99000, ctx({ mode: 'manual' }), /thu cong/],
    [null, 0, ctx(), /chua co du lieu/],
  ];
  for (const [tele, at, c, re] of cases) {
    const r = evaluate(tele, at, c);
    assert.equal(r.decision, 'skip', JSON.stringify(tele)); assert.match(r.reason, re);
  }
  // null không được coi là 0 °C
  assert.equal(evaluate(fresh(null), 99000, ctx()).decision, 'skip');
});

test('Bài 7: đang bật do luật thì gia hạn lease mỗi 30 s', () => {
  const t = fresh(31, { ledG: 1, fan: { by: 'auto' } });
  assert.equal(evaluate(t, 99000, ctx({ lastOnAt: 80000 })).decision, 'hold');
  assert.equal(evaluate(t, 99000, ctx({ lastOnAt: 60000 })).decision, 'renew');
});

test('Bài 8: ma trận vai–quyền và phân loại lệnh', () => {
  assert.ok(can('viewer', 'view') && !can('viewer', 'control') && !can('viewer', 'configure'));
  assert.ok(can('operator', 'control') && !can('operator', 'configure') && !can('operator', 'audit'));
  assert.ok(can('admin', 'configure') && can('admin', 'audit'));
  assert.ok(!can('hacker', 'view'));
  assert.equal(actionFor({ ledR: 1 }), 'control');
  assert.equal(actionFor({ cmd: 'start' }), 'control');
  assert.equal(actionFor({ lock: 1 }), 'control');
  assert.equal(actionFor({ lock: 0 }), 'configure', 'mở khóa chỉ admin');
  assert.equal(actionFor({ ledR: 1, lim: 300 }), 'configure', 'trộn khóa cấu hình vào lệnh điều khiển');
  assert.equal(actionFor({ outage: 20 }), 'configure');
  assert.equal(actionFor({ khoaLa: 1 }), 'configure');
});

test('Bài 8: mật khẩu băm scrypt, khóa tạm sau 5 lần sai, phiên hết hạn', () => {
  const h = hashPassword('dung-mat-khau');
  assert.ok(verifyPassword('dung-mat-khau', h) && !verifyPassword('sai', h) && !verifyPassword('x', 'plain'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const usersFile = path.join(dir, 'users.json');
  fs.writeFileSync(usersFile, JSON.stringify({ a: { role: 'operator', hash: h } }));
  let now = 0;
  const auth = createAuth({ usersFile, now: () => now, sessionMs: 1000 });
  for (let i = 0; i < 5; i++) assert.ok(auth.login('a', 'sai', 'ip').error);
  assert.ok(auth.login('a', 'dung-mat-khau', 'ip').locked, 'đúng mật khẩu vẫn bị khóa trong 60 s');
  now = 61000;
  const s = auth.login('a', 'dung-mat-khau', 'ip');
  assert.equal(s.role, 'operator');
  assert.equal(auth.session(s.token).user, 'a');
  now += 2000;
  assert.equal(auth.session(s.token), null, 'phiên hết hạn');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Bài 9: đối chiếu theo seq phát hiện mất, trùng, gửi bù', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-'));
  const f = path.join(dir, 'm.sqlite');
  const store = openMessageStore(f);
  const put = (seq, extra = {}) => store.append('vju/nhakinh/n1/telemetry', Buffer.from(JSON.stringify({ boot: 7, seq, t: 25, ...extra })), {}, Date.parse('2026-01-01T00:00:10Z') + seq);
  [1, 2, 3, 6, 7, 7].forEach((s) => put(s));
  [4].forEach((s) => put(s, { replay: 1 }));
  store.append('vju/nhakinh/n1/telemetry', Buffer.from('{hong'), {}, Date.parse('2026-01-01T00:00:10Z'));
  store.close();
  const [r] = seqReport(new Database(f, { readonly: true }), 'n1', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z');
  assert.deepEqual({ ...r, gaps: r.gaps }, { boot: 7, seq_from: 1, seq_to: 7, generated: 7, received_unique: 6, lost: 1, duplicates: 1, replayed: 1, live: 6, gaps: ['5'] });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----- Tích hợp: server thật + broker giả đóng vai ESP32 trả ack -----
async function waitFor(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + label); await new Promise((r) => setTimeout(r, 50)); }
}

test('Bài 6: lệnh qua API -> broker -> ack theo cmd_id; quá hạn; trùng; sai quyền bị chặn ở server', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bai6-'));
  const usersFile = path.join(dir, 'users.json');
  fs.writeFileSync(usersFile, JSON.stringify({ op: { role: 'operator', hash: hashPassword('p1') }, xem: { role: 'viewer', hash: hashPassword('p2') } }));
  const base = 'test/nk';
  let conn; const published = []; const sockets = new Set();
  let ackMode = 'ack';   // 'ack' | 'silent'
  const seen = new Set();
  const broker = net.createServer((socket) => {
    sockets.add(socket); conn = socket;
    const parser = mqttPacket.parser();
    socket.on('data', (b) => parser.parse(b));
    parser.on('packet', (p) => {
      if (p.cmd === 'connect') socket.write(mqttPacket.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }));
      if (p.cmd === 'subscribe') socket.write(mqttPacket.generate({ cmd: 'suback', messageId: p.messageId, granted: p.subscriptions.map(() => 1) }));
      if (p.cmd === 'publish') {
        published.push(p);
        if (p.qos) socket.write(mqttPacket.generate({ cmd: 'puback', messageId: p.messageId }));
        const c = JSON.parse(p.payload);
        if (ackMode === 'ack') {
          const status = seen.has(c.cmd_id) ? 'duplicate' : 'applied';
          seen.add(c.cmd_id);
          socket.write(mqttPacket.generate({ cmd: 'publish', topic: `${base}/n1/ack`, payload: Buffer.from(JSON.stringify({ cmd_id: c.cmd_id, status, reason: status === 'duplicate' ? 'applied' : '' })), qos: 0, retain: false, dup: false }));
        }
      }
      if (p.cmd === 'pingreq') socket.write(mqttPacket.generate({ cmd: 'pingresp' }));
    });
  });
  broker.listen(0, '127.0.0.1'); await once(broker, 'listening');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MQTT_URL: `mqtt://127.0.0.1:${broker.address().port}`, MQTT_BASE: base, DATA_DIR: dir, PORT: '0', HTTPS_PORT: '-1', USERS_FILE: usersFile, ACK_TIMEOUT_MS: '800' },
  });
  let output = ''; child.stdout.on('data', (b) => { output += b; }); child.stderr.on('data', (b) => { output += b; });
  try {
    const port = Number((await waitFor(() => output.match(/localhost:(\d+)/), 'http port: ' + output))[1]);
    await waitFor(() => output.includes('MQTT: da ket noi'), 'mqtt');
    const API = `http://127.0.0.1:${port}`;
    const login = async (user, pass) => (await fetch(API + '/api/login', { method: 'POST', body: JSON.stringify({ user, pass }) })).headers.get('set-cookie')?.split(';')[0];
    const op = await login('op', 'p1'), xem = await login('xem', 'p2');
    const post = (cookie, p, body) => fetch(API + p, { method: 'POST', headers: { Cookie: cookie || '', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const getCmd = async (id) => (await (await fetch(`${API}/api/commands/n1`, { headers: { Cookie: op } })).json()).commands.find((c) => c.cmd_id === id);

    // hợp lệ: 202 + pending, rồi applied khi có ack đúng mã
    let r = await post(op, '/api/cmd/n1', { ledR: 1, cmd_id: 'gia-mao', src: 'auto' });
    assert.equal(r.status, 202);
    const { cmd } = await r.json();
    assert.notEqual(cmd.cmd_id, 'gia-mao', 'client không được tự đặt cmd_id');
    assert.equal(JSON.parse(cmd.payload).src, 'manual', 'client không được tự đặt src=auto');
    assert.equal((await waitFor(async () => (await getCmd(cmd.cmd_id))?.status === 'applied' && getCmd(cmd.cmd_id), 'applied')).status, 'applied');
    // gửi lại cùng mã -> thiết bị báo trùng
    await post(op, '/api/cmd/n1', { resend: cmd.cmd_id });
    await waitFor(async () => (await getCmd(cmd.cmd_id))?.status === 'duplicate', 'duplicate');
    assert.equal(published.filter((p) => JSON.parse(p.payload).cmd_id === cmd.cmd_id).length, 2);
    // mất ack -> timeout, không tự báo thành công
    ackMode = 'silent';
    r = await post(op, '/api/cmd/n1', { ledR: 0 });
    const id2 = (await r.json()).cmd.cmd_id;
    assert.equal((await getCmd(id2)).status, 'pending');
    await waitFor(async () => (await getCmd(id2))?.status === 'timeout', 'timeout');
    // ack đến muộn vẫn được ghi, kèm ghi chú
    conn.write(mqttPacket.generate({ cmd: 'publish', topic: `${base}/n1/ack`, payload: Buffer.from(JSON.stringify({ cmd_id: id2, status: 'applied' })), qos: 0, retain: false, dup: false }));
    const late = await waitFor(async () => { const c = await getCmd(id2); return c?.status === 'applied' && c; }, 'late ack');
    assert.match(late.reason, /muon/);
    // sai quyền: bị chặn ở server, không có bản tin nào tới broker
    const before = published.length;
    assert.equal((await post(xem, '/api/cmd/n1', { ledR: 1 })).status, 403);
    assert.equal((await post(op, '/api/cmd/n1', { lim: 300 })).status, 403);
    assert.equal((await post(null, '/api/cmd/n1', { ledR: 1 })).status, 401);
    assert.equal((await fetch(API + '/stream')).status, 401, 'dữ liệu cũng cần đăng nhập');
    assert.equal(published.length, before);
    // audit có ghi các lần từ chối
    const db = new Database(path.join(dir, 'mqtt.sqlite'), { readonly: true });
    const results = db.prepare('SELECT result FROM audit').all().map((a) => a.result);
    assert.ok(results.includes('forbidden') && results.includes('unauthenticated') && results.includes('sent'));
    db.close();
  } finally {
    const stopped = child.exitCode === null ? once(child, 'close') : Promise.resolve();
    child.kill('SIGTERM'); await stopped;
    for (const s of sockets) s.destroy();
    await new Promise((r) => broker.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
