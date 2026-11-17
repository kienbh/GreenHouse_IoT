import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import mqttPacket from 'mqtt-packet';
import { openMessageStore } from '../mqtt-store.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, detail) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await pause(25);
  }
  throw new Error(`Timed out: ${detail}`);
}

test('preserves every raw payload, duplicates, timestamps and packet flags across reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhakinh-store-test-'));
  const filename = path.join(dir, 'mqtt.sqlite');
  let store;
  let db;
  try {
    store = openMessageStore(filename);
    const payload = Buffer.from([0x00, 0xff, 0x27, 0x0a]);
    store.append('vju/nhakinh/esp32-01/telemetry', payload, {}, 1000);
    store.append('vju/nhakinh/esp32-01/telemetry', payload, { qos: 1, retain: true, dup: true }, 2000);
    store.close();
    store = openMessageStore(filename);
    store.append('vju/nhakinh/esp32-01/status', Buffer.from('online'), {}, 3000);
    store.close();
    db = new Database(filename, { readonly: true });
    const rows = db.prepare('SELECT * FROM mqtt_messages ORDER BY id').all();
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0].payload, payload);
    assert.deepEqual(rows[1].payload, payload);
    assert.equal(rows[0].received_at, '1970-01-01T00:00:01.000Z');
    assert.equal(rows[1].qos, 1);
    assert.equal(rows[1].retain, 1);
    assert.equal(rows[1].dup, 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  } finally {
    if (db?.open) db.close();
    store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('server archives its four existing topic types and keeps CSV on isolated broker', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhakinh-server-test-'));
  const sockets = new Set();
  let subscription;
  let connection;
  const publishedByApp = [];
  const broker = net.createServer((socket) => {
    sockets.add(socket);
    connection = socket;
    socket.on('close', () => sockets.delete(socket));
    const parser = mqttPacket.parser();
    socket.on('data', (buf) => parser.parse(buf));
    parser.on('packet', (packet) => {
      if (packet.cmd === 'connect') socket.write(mqttPacket.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }));
      if (packet.cmd === 'subscribe') {
        subscription = packet.subscriptions.map((s) => s.topic);
        socket.write(mqttPacket.generate({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 1) }));
      }
      if (packet.cmd === 'publish') publishedByApp.push(packet);
      if (packet.cmd === 'pingreq') socket.write(mqttPacket.generate({ cmd: 'pingresp' }));
    });
  });
  broker.listen(0, '127.0.0.1');
  await once(broker, 'listening');
  const base = 'test/greenhouse/section';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: { ...process.env, MQTT_URL: `mqtt://127.0.0.1:${broker.address().port}`, MQTT_BASE: base, DATA_DIR: dir, PORT: '0', HTTPS_PORT: '-1', USERS_FILE: path.join(dir, 'users.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (buf) => { output += buf.toString(); });
  child.stderr.on('data', (buf) => { output += buf.toString(); });
  let db;
  try {
    await waitFor(() => subscription, `server subscription: ${output}`);
    assert.deepEqual(subscription.sort(), ['status', 'telemetry', 'event', 'cmd', 'ack'].map((kind) => `${base}/+/${kind}`).sort());
    const tele = '{"t":27.1,"h":60,"code":0,"pump":{"st":"DUNG","duty":50,"out":0}}';
    const messages = [
      ['status', 'online', true],
      ['telemetry', tele, false],
      ['telemetry', tele, false],
      ['event', '{"lv":"I","boot":1,"ms":123,"msg":"test only"}', false],
      ['cmd', '{"ledR":1}', false],
      ['telemetry', '{bad json', false],
      ['status', 'offline', false],
    ];
    for (const [kind, payload, retain] of messages) {
      connection.write(mqttPacket.generate({ cmd: 'publish', topic: `${base}/esp32-test/${kind}`, payload: Buffer.from(payload), qos: 0, retain, dup: false }));
    }
    db = new Database(path.join(dir, 'mqtt.sqlite'), { readonly: true });
    await waitFor(() => db.prepare('SELECT COUNT(*) AS n FROM mqtt_messages').get().n === messages.length, 'all MQTT rows');
    const rows = db.prepare('SELECT * FROM mqtt_messages ORDER BY id').all();
    assert.deepEqual(rows.map((r) => [r.topic.split('/').at(-1), r.payload.toString(), !!r.retain]), messages);
    assert.equal(publishedByApp.length, 0, 'archiving must not publish commands');
    const deviceDir = path.join(dir, 'esp32-test');
    const teleCsv = fs.readdirSync(deviceDir).find((f) => f.startsWith('telemetry-'));
    const eventCsv = fs.readdirSync(deviceDir).find((f) => f.startsWith('events-'));
    assert.equal(fs.readFileSync(path.join(deviceDir, teleCsv), 'utf8').trim().split('\n').length, 3);
    assert.equal(fs.readFileSync(path.join(deviceDir, eventCsv), 'utf8').trim().split('\n').length, 2);
    assert.ok(!output.includes('khong luu duoc'), output);
  } finally {
    if (db?.open) db.close();
    const stopped = child.exitCode === null ? once(child, 'close') : Promise.resolve();
    child.kill('SIGTERM');
    await stopped;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => broker.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
