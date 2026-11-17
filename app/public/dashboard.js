import { applyMessage, connectionState, controlAllowed, validNumber } from './ui-state.js';
const $ = (s) => document.querySelector(s);
let state = { broker: false, devices: {} }, streamOpen = false, current = new URLSearchParams(location.search).get('dev'), pending = 0, stopPending = false, selectionVersion = 0;
try { current ||= localStorage.getItem('dev'); } catch {}
const listeners = new Set(), rawMessages = [];
// Bài 6-8: người dùng hiện tại, lệnh gần đây (cmd_id -> bản ghi), nhật ký luật của thiết bị đang chọn
let me = null, lastSentId = null, ruleLog = [];
const cmds = new Map();
const CMD_LABEL = { pending: 'Đang chờ', applied: 'Đã xác nhận', rejected: 'Bị từ chối', timeout: 'Quá hạn', duplicate: 'Trùng' };
const RULE_LABEL = { on: 'BẬT', off: 'TẮT', renew: 'gia hạn', hold: 'giữ', skip: 'không quyết định', mode: 'đổi chế độ' };
const fields = ['th', 'duty', 'lim', 'cd'];
const dirty = new Set();
const SONG_NAMES = ['Happy Birthday', 'Twinkle Twinkle', 'Jingle Bells', 'Bíp'];
const PUMP_NAMES = { DUNG: 'Đã dừng', CHAY: 'Đang chạy', LOI: 'Có lỗi' };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('vi-VN');
const display = (v) => v === null || v === undefined || v === '' ? '--' : String(v);
export function readView() {
  const device = state.devices[current];
  return { current, device, tele: device?.tele, connection: connectionState(state, device, streamOpen), pending };
}
export function subscribeView(fn) { listeners.add(fn); fn(readView()); return () => listeners.delete(fn); }
function feedback(text, error = false) { $('#sent').textContent = text; $('#sent').classList.toggle('error', error); }
function pill(id, text, ok) { $(id).textContent = text; $(id).className = 'pill' + (ok === true ? ' ok' : ok === false ? ' bad' : ''); }
function selectedChanged() {
  selectionVersion++; dirty.clear(); fields.forEach((id) => { $('#' + id).value = ''; });
  feedback(''); $('#cmd').value = '{"ledG":1}';
  $('#inspectTitle').textContent = 'Khám phá mô hình';
  $('#inspectText').textContent = 'Chọn nhãn hoặc bộ phận để xem thông tin của thiết bị đang chọn.';
  $('#pick').textContent = '';
  try { if (current) localStorage.setItem('dev', current); } catch {}
  renderRaw(); loadHistory();
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname); throw new Error('chưa đăng nhập'); }
  return { status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) };
}
async function loadHistory() {
  const dev = current; cmds.clear(); ruleLog = []; renderCmds(); renderRuleLog();
  if (!dev) return;
  const [c, r] = await Promise.all([api('/api/commands/' + encodeURIComponent(dev)), api('/api/rules/' + encodeURIComponent(dev))]);
  if (dev !== current) return;
  for (const row of (c.body.commands || []).reverse()) cmds.set(row.cmd_id, row);
  ruleLog = r.body.log || []; renderCmds(); renderRuleLog();
}
const cmdText = (row) => { try { const o = JSON.parse(row.payload); delete o.cmd_id; return JSON.stringify(o); } catch { return row.payload; } };
function renderCmds() {
  const list = $('#cmds'); list.replaceChildren();
  const rows = [...cmds.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12);
  if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Chưa có lệnh cho thiết bị này.'; list.append(li); }
  for (const row of rows) {
    const li = document.createElement('li'), chip = document.createElement('span'), text = document.createElement('span');
    chip.className = 'chip ' + row.status; chip.textContent = CMD_LABEL[row.status] || row.status;
    const extra = row.status === 'applied' ? `ack sau ${row.latency_ms} ms` : row.status === 'timeout' ? 'chưa xác nhận: không suy ra thiết bị đã hoặc chưa thực hiện' : row.reason || '';
    text.innerHTML = ''; text.append(`${cmdText(row)} · ${row.user} · ${fmtTime(row.created_at)}${row.sends > 1 ? ` · gửi ${row.sends} lần` : ''}`);
    if (extra) { const small = document.createElement('div'); small.className = 'hint'; small.textContent = extra; text.append(small); }
    const code = document.createElement('code'); code.textContent = row.cmd_id; text.append(code);
    li.append(chip, text);
    if (row.status === 'timeout' && me?.can.control) {
      const b = document.createElement('button'); b.textContent = 'Gửi lại cùng mã';
      b.title = 'Gửi lại đúng cmd_id: nếu ESP32 đã thực hiện, nó báo trùng và không chạy lại';
      b.onclick = () => resend(row.cmd_id); li.append(b);
    } else li.append(document.createElement('span'));
    list.append(li);
  }
}
function renderRuleLog() {
  const list = $('#ruleLog'); list.replaceChildren();
  if (!ruleLog.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Chưa có quyết định nào.'; list.append(li); }
  for (const l of ruleLog.slice(0, 20)) {
    const li = document.createElement('li'), time = document.createElement('time'), text = document.createElement('span');
    li.className = l.decision === 'skip' ? 'lvW' : '';
    time.textContent = fmtTime(l.at);
    text.textContent = `[${RULE_LABEL[l.decision] || l.decision}] ${l.t != null ? `t=${l.t} °C${l.test ? ' (dữ liệu thử)' : ''} · ` : ''}${l.reason}`;
    li.append(time, text); list.append(li);
  }
}
async function resend(id) {
  const r = await api('/api/cmd/' + encodeURIComponent(current), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resend: id }) });
  if (r.ok) { cmds.set(id, r.body.cmd); lastSentId = id; renderCmds(); feedback(`Đã gửi lại ${id}, chờ ESP32 xác nhận…`); }
  else feedback(`Không gửi lại được: ${r.body.err || r.status}`, true);
}
async function setMode(mode) {
  const r = await api('/api/mode/' + encodeURIComponent(current), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
  feedback(r.ok ? `Đã chuyển sang ${mode === 'auto' ? 'TỰ ĐỘNG' : 'THỦ CÔNG'}. Không phát lại lệnh cũ; luật đánh giá ở bản tin kế tiếp.` : `Không đổi được chế độ: ${r.body.err || r.status}`, !r.ok);
}
function renderDevices() {
  const previous = current, names = Object.keys(state.devices).sort();
  if (!names.includes(current)) current = names.find((n) => state.devices[n].status === 'online') || names[0] || null;
  const select = $('#dev');
  if (JSON.stringify(names) !== select.dataset.names) {
    select.replaceChildren(...names.map((name) => new Option(name, name)));
    if (!names.length) select.add(new Option('Chưa có thiết bị', ''));
    select.dataset.names = JSON.stringify(names);
  }
  select.value = current || ''; select.disabled = !names.length;
  if (current !== previous) selectedChanged();
}
function renderEvents(device) {
  const events = device?.events || [], list = $('#events');
  $('#eventCount').textContent = `${events.length} sự kiện`;
  const signature = current + ':' + JSON.stringify(events.slice(-30));
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature; list.replaceChildren();
  if (!events.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Chưa có sự kiện của thiết bị này.'; list.append(li); }
  for (const e of events.slice(-30).reverse()) {
    const li = document.createElement('li'), time = document.createElement('time'), text = document.createElement('span');
    li.className = ['E', 'W'].includes(e.lv) ? 'lv' + e.lv : '';
    time.textContent = fmtTime(e.ts); text.textContent = `[${e.lv || 'I'}] ${e.msg || ''}`;
    li.append(time, text); list.append(li);
  }
}
function renderRaw() {
  const list = $('#raw'); list.replaceChildren();
  const messages = rawMessages.filter((m) => m.dev === current).slice(-60).reverse();
  if (!messages.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Chưa có bản tin trong phiên xem này.'; list.append(li); }
  for (const m of messages) { const li = document.createElement('li'); li.textContent = `${fmtTime(m.ts)} ${m.kind} ${typeof m.data === 'string' ? m.data : JSON.stringify(m.data)}`; list.append(li); }
}
function render() {
  const { device: d, tele: x, connection: c } = readView(), p = x?.pump || {};
  $('#connection').className = 'connection ' + c.tone;
  $('#connectionTitle').textContent = c.label; $('#connectionDetail').textContent = c.detail;
  pill('#broker', !streamOpen ? 'Ứng dụng: mất kết nối' : state.broker ? 'MQTT: đã kết nối' : 'MQTT: mất kết nối', streamOpen && state.broker);
  pill('#online', 'Thiết bị: ' + (d?.status === 'online' ? 'trực tuyến' : d?.status === 'offline' ? 'ngoại tuyến' : 'chưa rõ'), d?.status === 'online' ? true : d?.status === 'offline' ? false : null);
  $('#t').textContent = display(x?.t); $('#h').textContent = display(x?.h);
  $('#sensorState').textContent = !x ? 'Chờ cảm biến' : x.code ? `Lỗi cảm biến E${x.code}` : !c.ready ? 'Giá trị nhận lần cuối' : 'Cảm biến hoạt động';
  $('#freshness').textContent = !c.at ? 'Chưa có dữ liệu' : c.age < 60000 ? `${Math.floor(c.age / 1000)} giây trước` : `${Math.floor(c.age / 60000)} phút trước`;
  $('#pumpMetric').textContent = PUMP_NAMES[p.st] || '--';
  $('#pumpMetricInfo').textContent = !x ? 'Chờ trạng thái' : !c.ready ? 'Trạng thái nhận lần cuối' : p.st === 'CHAY' ? `Đầu ra ${display(p.out)}%` : p.cool > 0 ? `Đang nghỉ ${p.cool}s` : 'Theo trạng thái thiết bị';
  $('#pst').textContent = PUMP_NAMES[p.st] || 'Chưa có dữ liệu'; $('#pst').className = 'st ' + (p.st || '');
  $('#pinfo').textContent = p.st === 'CHAY' ? `${display(p.el)} / ${display(p.lim)} giây` : p.cool > 0 ? `Nghỉ ${p.cool}s` : '';
  $('#pmsg').textContent = p.msg || (x ? 'Thiết bị chưa báo thông tin máy bơm.' : 'Chờ dữ liệu từ thiết bị.');
  $('#pumpHint').textContent = !c.ready ? 'Đã khóa điều khiển: cần kết nối và dữ liệu mới.' : p.st === 'LOI' ? 'Bơm đang lỗi. Kiểm tra thông báo của thiết bị.' : p.cool > 0 ? 'Chờ hết thời gian nghỉ trước khi chạy lại.' : p.st === 'CHAY' ? 'Bơm đang chạy. Nút Dừng gửi lệnh dừng ngay.' : x?.code ? 'Cần xử lý lỗi cảm biến trước khi chạy bơm.' : 'Bơm tự dừng theo thời gian tối đa đã cấu hình.';
  $('#autoHint').textContent = x?.auto ? 'Tự động đang bật: LED đỏ/xanh do ESP32 quản lý' : 'Điều khiển riêng từng đèn';
  for (const b of document.querySelectorAll('[data-k]')) {
    const on = !!x?.[b.dataset.k]; b.classList.toggle('on', on); b.textContent = !x ? '--' : on ? 'Đang bật' : 'Đang tắt'; b.setAttribute('aria-pressed', String(on));
  }
  for (const b of document.querySelectorAll('[data-arr], [data-song]')) {
    const on = x && (b.dataset.arr !== undefined ? +b.dataset.arr === x.ledArray : +b.dataset.song === x.song);
    b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', String(!!on));
  }
  for (const [id, value] of [['th', x?.th], ['duty', p.duty], ['lim', p.lim], ['cd', p.cd]]) {
    if (!x || (!dirty.has(id) && document.activeElement !== $('#' + id))) $('#' + id).value = value ?? '';
  }
  const mode = d?.mode || 'manual', online = streamOpen && state.broker && d?.status === 'online';
  $('#modeBadge').textContent = mode === 'auto' ? 'TỰ ĐỘNG' : 'THỦ CÔNG';
  $('#modeManual').classList.toggle('on', mode === 'manual'); $('#modeAuto').classList.toggle('on', mode === 'auto');
  const R = state.rule;
  $('#ruleInfo').textContent = R ? `Bật LED xanh (quạt) khi t ≥ ${R.onAt} °C, tắt khi t ≤ ${R.offAt} °C; dữ liệu cũ hơn ${R.staleMs / 1000} s hoặc lỗi thì không quyết định` : 'Luật thông gió chạy trên dịch vụ';
  $('#fanInfo').textContent = !x ? 'LED xanh giả lập quạt thông gió.' : `LED xanh ${x.ledG ? 'BẬT' : 'tắt'}${x.fan?.by === 'auto' && x.ledG ? ` do luật, ESP32 tự tắt sau ${x.fan.lease}s nếu không được gia hạn` : ''}${x.src === 'test' ? ' · đang dùng DỮ LIỆU THỬ' : ''}`;
  $('#lockInfo').textContent = x?.lock ? 'ĐANG KHÓA AN TOÀN: bơm không chạy, ESP32 từ chối lệnh tự động. Chỉ quản trị được mở khóa.' : 'Khóa: dừng bơm, tắt tải do luật bật, ESP32 từ chối lệnh tự động. Chỉ quản trị được mở khóa.';
  $('#lockOn').classList.toggle('on', !!x?.lock);
  for (const el of document.querySelectorAll('[data-control]')) {
    const k = el.dataset.control, perm = el.dataset.perm === 'configure' ? 'configure' : 'control';
    const allowedRole = !!me?.can[perm];
    let ok;
    if (k === 'mode') ok = streamOpen && !!d;
    else if (k === 'lockOn') ok = online && !x?.lock;                   // khóa an toàn không đòi dữ liệu mới
    else if (k === 'lockOff') ok = online && !!x?.lock;
    else ok = controlAllowed(c, x, k, pending > 0) && !(k === 'stopPump' && stopPending) && !(k === 'ledG' && mode === 'auto');
    el.disabled = !ok || !allowedRole;
    el.title = !allowedRole ? `Vai ${me?.role || '?'} không có quyền ${perm === 'configure' ? 'cấu hình' : 'điều khiển'}` : !c.ready && !['mode', 'lockOn', 'lockOff'].includes(k) ? c.label : pending ? 'Đang gửi lệnh' : k === 'ledG' && mode === 'auto' ? 'LED xanh đang do luật tự động quản lý' : ['ledR', 'ledG'].includes(k) && x?.auto ? 'Tắt chế độ tự động tại ESP32 để điều khiển LED' : '';
  }
  $('#meta').textContent = !x ? 'Chưa nhận được telemetry' : `Nhận lúc ${fmtTime(c.at)} · RSSI ${display(x.rssi)} dBm · boot #${display(x.boot)} · seq ${display(x.seq)}${x.buf ? ` · đệm ${x.buf.n}/${x.buf.max}, đã bỏ ${x.buf.drop}` : ''}`;
  $('#viewState').textContent = c.ready ? 'Đang hiển thị dữ liệu trực tiếp' : c.label + ' · hiệu ứng trực tiếp tạm dừng';
  for (const [id, kind] of [['csvT', 'telemetry'], ['csvE', 'events']]) {
    const a = $('#' + id); a.setAttribute('aria-disabled', String(!current));
    if (current) a.href = `/api/csv/${encodeURIComponent(current)}/${kind}`; else a.removeAttribute('href');
  }
  renderEvents(d); drawChart(d?.hist || []);
  for (const fn of listeners) fn(readView());
}
async function send(cmd, kind = '', resetFields = []) {
  const view = readView();
  if (!['lockOn', 'lockOff'].includes(kind) && (!controlAllowed(view.connection, view.tele, kind, pending > 0) || (kind === 'stopPump' && stopPending))) { feedback('Không gửi lệnh: ' + (pending ? 'đang có lệnh chờ.' : view.connection.ready ? 'thao tác chưa khả dụng ở trạng thái này.' : view.connection.label), true); return; }
  const target = current, version = selectionVersion; pending++; if (kind === 'stopPump') stopPending = true; feedback(`Đang gửi lệnh tới ${target}…`); render();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api/cmd/' + encodeURIComponent(target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: controller.signal });
    if (response.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname); return; }
    const result = await response.json();
    if (target !== current || version !== selectionVersion) return;
    if (!response.ok || !result.ok) throw new Error(result.err || `HTTP ${response.status}`);
    resetFields.forEach((id) => dirty.delete(id));
    cmds.set(result.cmd.cmd_id, result.cmd); lastSentId = result.cmd.cmd_id; renderCmds();
    if (cmds.get(lastSentId).status === 'pending') feedback(`Broker đã nhận lệnh ${lastSentId}. Đang chờ ${target} xác nhận…`);
  } catch (error) {
    if (target === current && version === selectionVersion) feedback(error.name === 'AbortError' ? 'Chưa xác nhận được kết quả gửi. Kiểm tra trạng thái thiết bị trước khi thử lại.' : `Không xác nhận được lệnh: ${error.message}. Kiểm tra trạng thái trước khi thử lại.`, true);
  } finally { clearTimeout(timeout); pending--; if (kind === 'stopPump') stopPending = false; render(); }
}
function numbersValid(specs) {
  for (const [id, min, max, integer] of specs) {
    if (!validNumber($('#' + id).value, min, max, integer)) { feedback(`Giá trị ${id} phải ${integer ? 'là số nguyên ' : ''}từ ${min} đến ${max}.`, true); $('#' + id).focus(); return false; }
  }
  return true;
}
function drawChart(hist) {
  const c = $('#chart'), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
  const now = Date.now(), span = 1800000, pts = hist.filter((p) => p[0] >= now - span);
  const L = 32, R = W - 34, T = 14, B = H - 24;
  g.font = '10px system-ui'; g.fillStyle = col('--mut'); g.strokeStyle = col('--line'); g.lineWidth = 1;
  const values = pts.map((p) => p[1]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const tMin = Math.floor(Math.min(...values, 20) - 1), tMax = Math.ceil(Math.max(...values, 35) + 1);
  for (let i = 0; i <= 4; i++) { const y = T + (B - T) * i / 4; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.textAlign = 'right'; g.fillText((tMax - (tMax - tMin) * i / 4).toFixed(0) + '°', L - 5, y + 4); g.textAlign = 'left'; g.fillText((100 - 25 * i) + '%', R + 5, y + 4); }
  g.textAlign = 'center';
  for (let m = 30; m >= 0; m -= 10) g.fillText(m ? `-${m} ph` : 'Hiện tại', L + (R - L) * (1 - m / 30), H - 4);
  if (!pts.length) { g.fillText('Chưa có dữ liệu trong 30 phút qua', (L + R) / 2, (T + B) / 2); return; }
  const X = (ts) => L + (R - L) * (ts - (now - span)) / span;
  function line(idx, color, Y) { g.strokeStyle = color; g.lineWidth = 2; g.beginPath(); let previous = null; for (const p of pts) { if (typeof p[idx] !== 'number' || !Number.isFinite(p[idx])) { previous = null; continue; } if (previous && p[0] - previous[0] < 15000) g.lineTo(X(p[0]), Y(p[idx])); else g.moveTo(X(p[0]), Y(p[idx])); previous = p; } g.stroke(); }
  line(1, col('--t'), (v) => B - (B - T) * (v - tMin) / (tMax - tMin)); line(2, col('--h'), (v) => B - (B - T) * v / 100);
}
function onExtra(m) {
  if (m.kind === 'mode' && state.devices[m.dev]) state.devices[m.dev].mode = m.data.mode;
  if (m.kind === 'rule' && m.dev === current) { ruleLog.unshift(m.data); renderRuleLog(); }
  if (m.kind === 'cmd' && m.dev === current) {
    cmds.set(m.data.cmd_id, m.data); renderCmds();
    if (m.data.cmd_id === lastSentId) {
      const r = m.data;
      if (r.status === 'applied') feedback(`${current} đã xác nhận áp dụng lệnh sau ${r.latency_ms} ms.${r.reason ? ' ' + r.reason : ''}`);
      else if (r.status === 'rejected') feedback(`${current} từ chối lệnh: ${r.reason || 'không rõ lý do'}.`, true);
      else if (r.status === 'duplicate') feedback(`${current} báo lệnh trùng, không thực hiện lại (lần đầu: ${(r.ack_payload && JSON.parse(r.ack_payload).reason) || '?'}).`);
      else if (r.status === 'timeout') feedback(`Quá hạn: chưa nhận xác nhận từ ${current}. Chưa biết thiết bị đã thực hiện hay chưa; kiểm tra trạng thái trước khi gửi lại.`, true);
    }
  }
}
$('#modeManual').onclick = () => setMode('manual');
$('#modeAuto').onclick = () => setMode('auto');
$('#lockOn').onclick = () => send({ lock: 1 }, 'lockOn');
$('#lockOff').onclick = () => { if (confirm('Mở khóa an toàn? Bơm và luật tự động sẽ được phép hoạt động lại.')) send({ lock: 0 }, 'lockOff'); };
$('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; };
$('#dev').addEventListener('change', () => { current = $('#dev').value; selectedChanged(); render(); });
fields.forEach((id) => $('#' + id).addEventListener('input', () => dirty.add(id)));
for (const b of document.querySelectorAll('[data-k]')) b.onclick = () => send({ [b.dataset.k]: readView().tele?.[b.dataset.k] ? 0 : 1 }, b.dataset.k);
for (const b of document.querySelectorAll('[data-arr]')) b.onclick = () => send({ ledArray: +b.dataset.arr });
$('#pStart').onclick = () => send({ cmd: 'start' }, 'start');
$('#pStop').onclick = () => send({ cmd: 'stop' }, 'stopPump');
$('#thSet').onclick = () => { if (numbersValid([['th', 0, 50, false]])) send({ th: +$('#th').value }, '', ['th']); };
$('#cfgSet').onclick = () => { if (numbersValid([['duty', 1, 100, true], ['lim', 3, 300, true], ['cd', 0, 600, true]])) send({ duty: +$('#duty').value, lim: +$('#lim').value, cd: +$('#cd').value }, '', ['duty', 'lim', 'cd']); };
$('#send').onclick = () => { try { const cmd = JSON.parse($('#cmd').value); if (!cmd || Array.isArray(cmd) || typeof cmd !== 'object') throw new Error(); send(cmd); } catch { feedback('JSON không hợp lệ. Cần một object, ví dụ {"ledG":1}.', true); } };
for (const [i, name] of SONG_NAMES.entries()) { const b = document.createElement('button'); b.textContent = '♪ ' + name; b.dataset.song = i; b.dataset.control = ''; b.disabled = true; b.onclick = () => send({ play: i }); $('#songs').append(b); }
const stopSong = document.createElement('button'); stopSong.textContent = 'Tắt âm thanh'; stopSong.dataset.control = ''; stopSong.className = 'danger'; stopSong.disabled = true; stopSong.onclick = () => send({ stop: 1 }); $('#songs').append(stopSong);
$(location.pathname.includes('3d') ? '#navTwin' : '#navOverview').setAttribute('aria-current', 'page');
try {
  const who = await api('/api/me');
  me = who.body;
  const roleName = { viewer: 'chỉ xem', operator: 'vận hành', admin: 'quản trị' }[me.role] || me.role;
  $('#who').textContent = `${me.user} · ${roleName}`;
  const ACT = { view: 'xem', control: 'điều khiển (LED, bơm, chế độ luật, bật khóa)', configure: 'cấu hình (ngưỡng, bơm, dữ liệu thử, mở khóa, JSON)', audit: 'xem audit' };
  const yes = Object.keys(ACT).filter((a) => me.can[a]), no = Object.keys(ACT).filter((a) => !me.can[a]);
  $('#perm').textContent = `Đăng nhập: ${me.user} (vai ${me.role}). Được: ${yes.map((a) => ACT[a]).join('; ')}.${no.length ? ` Không được: ${no.map((a) => ACT[a]).join('; ')} – nút tương ứng bị khóa và máy chủ trả 403 nếu gọi thẳng API.` : ''}`;
} catch { /* đã chuyển tới trang đăng nhập */ }
const es = new EventSource('/stream');
es.onmessage = (event) => {
  try { const m = JSON.parse(event.data); streamOpen = true; onExtra(m); state = applyMessage(state, m); renderDevices(); if (m.dev) { rawMessages.push(m); if (rawMessages.length > 300) rawMessages.shift(); if (m.dev === current) renderRaw(); } render(); } catch (error) { console.warn('Bỏ qua bản tin giao diện không hợp lệ', error); }
};
es.onerror = () => { streamOpen = false; render(); };
setInterval(render, 1000); addEventListener('resize', render); render();
import('./twin.js').catch((error) => { $('#loading').textContent = 'Không mở được mô hình 3D. Dashboard vẫn hoạt động. Thử tải lại trang hoặc kiểm tra WebGL.'; console.error('3D unavailable:', error); });
