import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyMessage, connectionState, controlAllowed, telemetryTime, validNumber, STALE_MS } from '../public/ui-state.js';
const NOW = 100000;
const device = () => ({ status: 'online', tele: { t: 25, h: 60, code: 0, pump: { st: 'DUNG', cool: 0 } }, hist: [[NOW, 25, 60]], events: [] });
const status = (d, extra = {}) => connectionState({ broker: true, ...extra }, d, true, NOW);
test('fresh online telemetry enables controls; offline, stale and unknown block them', () => {
  const d = device(); assert.equal(status(d).ready, true);
  d.status = 'offline'; assert.equal(status(d).ready, false);
  d.status = 'unknown'; assert.equal(status(d).ready, false);
  d.status = 'online'; d.hist[0][0] = NOW - STALE_MS - 1; assert.equal(status(d).ready, false);
});
test('server/SSE loss and broker loss disable even fresh online devices', () => {
  assert.equal(connectionState({ broker: true }, device(), false, NOW).ready, false);
  assert.equal(status(device(), { broker: false }).ready, false);
});
test('no telemetry and no device are never ready', () => {
  assert.equal(status(null).ready, false);
  const d = device(); d.tele = null; assert.equal(status(d).ready, false); assert.equal(telemetryTime(d), 0);
});
test('status and events do not refresh old telemetry', () => {
  let s = { devices: { a: device() }, broker: true }; s.devices.a.hist[0][0] = NOW - 60000;
  s = applyMessage(s, { kind: 'status', dev: 'a', data: 'online', ts: NOW });
  s = applyMessage(s, { kind: 'event', dev: 'a', data: { msg: 'new event' }, ts: NOW });
  assert.equal(s.devices.a.seen, NOW); assert.equal(status(s.devices.a).ready, false);
});
test('telemetry advances its own clock and remains isolated per device', () => {
  let s = { devices: { a: device() }, broker: true };
  s = applyMessage(s, { kind: 'status', dev: 'b', data: 'online', ts: NOW });
  assert.equal(s.devices.b.tele, null); assert.equal(status(s.devices.b).ready, false);
  s = applyMessage(s, { kind: 'telemetry', dev: 'b', data: { t: 19, h: 40 }, ts: NOW });
  assert.equal(s.devices.b.teleAt, NOW); assert.equal(s.devices.a.tele.t, 25); assert.equal(s.devices.b.tele.t, 19);
});
test('snapshots use history timestamps and replace previous device state', () => {
  const s = applyMessage({ devices: { old: device() } }, { kind: 'snapshot', broker: true, devices: { new: device() } });
  assert.deepEqual(Object.keys(s.devices), ['new']); assert.equal(telemetryTime(s.devices.new), NOW); assert.equal(status(s.devices.new).ready, true);
});
test('automatic LEDs, pending commands, cooling, faults and pump state gate actions', () => {
  const d = device(), c = status(d);
  assert.equal(controlAllowed(c, d.tele, 'start'), true); assert.equal(controlAllowed(c, d.tele, 'stopPump'), false);
  d.tele.auto = 1; assert.equal(controlAllowed(c, d.tele, 'ledR'), false); assert.equal(controlAllowed(c, d.tele, 'ledG'), false);
  assert.equal(controlAllowed(c, d.tele, '', true), false);
  d.tele.pump.cool = 2; assert.equal(controlAllowed(c, d.tele, 'start'), false);
  d.tele.pump.cool = 0; d.tele.pump.st = 'CHAY'; assert.equal(controlAllowed(c, d.tele, 'start'), false); assert.equal(controlAllowed(c, d.tele, 'stopPump'), true); assert.equal(controlAllowed(c, d.tele, 'stopPump', true), true, 'Stop stays available during unrelated requests');
  d.tele.pump.st = 'LOI'; assert.equal(controlAllowed(c, d.tele, 'start'), false);
  d.tele.pump.st = 'DUNG'; d.tele.code = 1; assert.equal(controlAllowed(c, d.tele, 'start'), false);
});
test('numeric limits reject blank, malformed, fractional and out of range settings', () => {
  for (const v of ['', 'nope', 'NaN', 'Infinity', '0', '101', '2.5']) assert.equal(validNumber(v, 1, 100, true), false, v);
  assert.equal(validNumber('100', 1, 100, true), true); assert.equal(validNumber('25.5', 0, 50), true);
});
test('history and event buffers are bounded', () => {
  let s = { devices: {} };
  for (let i = 0; i < 1500; i++) s = applyMessage(s, { kind: 'telemetry', dev: 'a', data: { t: i }, ts: i + 1 });
  for (let i = 0; i < 250; i++) s = applyMessage(s, { kind: 'event', dev: 'a', data: { msg: 'event' }, ts: i + 1 });
  assert.equal(s.devices.a.hist.length, 1440); assert.equal(s.devices.a.events.length, 200);
});
test('3D cannot send commands and both routes use shared dashboard', () => {
  const twin = fs.readFileSync(new URL('../public/twin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(twin, /\/api\/cmd|\bfetch\s*\(|\bsend\s*\(|\bEventSource\s*\(/);
  assert.match(twin, /inspect\('pump'\)/);
  for (const page of ['index.html', '3d.html']) {
    const html = fs.readFileSync(new URL('../public/' + page, import.meta.url), 'utf8');
    assert.match(html, /src="\/dashboard.js"/); assert.match(html, /CHỈ QUAN SÁT/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]); assert.equal(new Set(ids).size, ids.length);
  }
});
