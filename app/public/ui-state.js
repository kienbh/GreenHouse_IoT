// Pure UI state helpers. Telemetry freshness must never use event/status timestamps.
export const STALE_MS = 15000;
export function telemetryTime(device) {
  if (!device?.tele) return 0;
  return device.teleAt || device.hist?.at(-1)?.[0] || 0;
}
export function connectionState(state, device, streamOpen, now = Date.now()) {
  const at = telemetryTime(device);
  const age = at ? Math.max(0, now - at) : Infinity;
  if (!streamOpen) return { ready: false, tone: 'bad', label: 'Mất kết nối ứng dụng', detail: 'Đang tự kết nối lại. Điều khiển tạm khóa.', age, at };
  if (!state.broker) return { ready: false, tone: 'bad', label: 'Mất kết nối MQTT', detail: 'Kiểm tra broker và mạng. Điều khiển tạm khóa.', age, at };
  if (!device) return { ready: false, tone: 'muted', label: 'Chưa có thiết bị', detail: 'Kết nối ESP32 hoặc bộ giả lập để bắt đầu.', age, at };
  if (device.status !== 'online') return { ready: false, tone: 'bad', label: device.status === 'offline' ? 'Thiết bị ngoại tuyến' : 'Chưa xác nhận kết nối', detail: 'Dữ liệu bên dưới là lần nhận cuối, không phải trạng thái trực tiếp.', age, at };
  if (!device.tele || !at) return { ready: false, tone: 'warn', label: 'Đang chờ dữ liệu', detail: 'Thiết bị đã kết nối. Chờ bản tin cảm biến đầu tiên để điều khiển.', age, at };
  if (age > STALE_MS) return { ready: false, tone: 'warn', label: 'Dữ liệu đã cũ', detail: 'Hơn 15 giây chưa có telemetry. Kiểm tra thiết bị trước khi điều khiển.', age, at };
  return { ready: true, tone: 'ok', label: 'Đang cập nhật trực tiếp', detail: 'Dữ liệu từ thiết bị. Lệnh điều khiển chỉ gửi từ các nút bên dưới.', age, at };
}
export function applyMessage(state, m) {
  if (m.kind === 'snapshot') return { ...m, devices: m.devices || {} };
  if (m.kind === 'broker') { state.broker = !!m.ok; return state; }
  if (!m.dev || !['status', 'telemetry', 'event'].includes(m.kind)) return state;
  const d = state.devices[m.dev] ||= { status: 'unknown', tele: null, seen: 0, hist: [], events: [] };
  d.seen = m.ts;
  if (m.kind === 'status') d.status = m.data;
  if (m.kind === 'telemetry' && m.data && typeof m.data === 'object') {
    d.tele = m.data; d.teleAt = m.ts;
    (d.hist ||= []).push([m.ts, m.data.t, m.data.h]);
    if (d.hist.length > 1440) d.hist.splice(0, d.hist.length - 1440);
  }
  if (m.kind === 'event' && m.data && typeof m.data === 'object') {
    (d.events ||= []).push({ ...m.data, ts: m.ts });
    if (d.events.length > 200) d.events.shift();
  }
  return state;
}
export function controlAllowed(connection, tele, kind, pending = false) {
  if (!connection.ready || (pending && kind !== 'stopPump')) return false;
  if (['ledR', 'ledG'].includes(kind) && tele?.auto) return false;
  if (kind === 'start') return tele?.pump?.st === 'DUNG' && !(tele.pump.cool > 0) && tele.code === 0;
  if (kind === 'stopPump') return tele?.pump?.st === 'CHAY';
  return true;
}
export function validNumber(value, min, max, integer = false) {
  return value !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max && (!integer || Number.isInteger(Number(value)));
}
