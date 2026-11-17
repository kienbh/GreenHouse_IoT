// Bài 7: luật thông gió chạy trên dịch vụ (server). Hàm evaluate() thuần, không có I/O, để kiểm bằng dữ liệu thử.
// Ngưỡng là MINH HỌA THUẬT TOÁN, không phải khuyến nghị vận hành nhà kính.
//   t >= ON_AT  -> bật LED xanh (giả lập quạt thông gió)
//   t <= OFF_AT -> tắt
//   ở giữa      -> giữ nguyên (dải trễ 2 °C chống bật/tắt liên tục khi số đo dao động quanh ngưỡng)
// Thứ tự ưu tiên: khóa an toàn/lỗi tại node > dữ liệu không hợp lệ/quá cũ > chế độ đang chọn (tự động/thủ công).
// Luật chỉ ĐỀ XUẤT lệnh; ESP32 vẫn tự từ chối khi khóa/lỗi và tự tắt khi lệnh hết hạn (lease).
export const RULE = {
  name: 'thong-gio-30-28',
  onAt: 30,
  offAt: 28,
  staleMs: 15000,      // dữ liệu cũ hơn 15 s thì không ra quyết định
  minGapMs: 10000,     // hai lệnh liên tiếp cách nhau tối thiểu 10 s
  renewMs: 30000,      // đang bật thì gia hạn lease mỗi 30 s
  leaseS: 90,          // node tự tắt nếu 90 s không được gia hạn
};

// tele: telemetry mới nhất; teleAt: lúc nhận (ms); ctx: { mode, lastCmdAt, lastOnAt, now }
// Trả { decision: 'on'|'off'|'renew'|'hold'|'skip', reason }
export function evaluate(tele, teleAt, ctx, rule = RULE) {
  const now = ctx.now ?? Date.now();
  if (ctx.mode !== 'auto') return { decision: 'skip', reason: 'che do thu cong: luat khong tac dong' };
  if (!tele) return { decision: 'skip', reason: 'chua co du lieu' };
  if (tele.lock) return { decision: 'skip', reason: 'node dang khoa an toan' };
  if (tele.pump?.st === 'LOI') return { decision: 'skip', reason: 'may bom dang LOI, cho xu ly' };
  if (tele.auto) return { decision: 'skip', reason: 'xung dot: che do tu dong tai node dang bat' };
  const age = now - teleAt;
  if (!(age <= rule.staleMs)) return { decision: 'skip', reason: `du lieu qua cu (${Math.round(age / 1000)} s)` };
  if (tele.code || tele.valid === false || typeof tele.t !== 'number' || !Number.isFinite(tele.t))
    return { decision: 'skip', reason: `loi cam bien (code ${tele.code ?? '?'}), khong dung so do` };
  const on = !!tele.ledG, t = tele.t;
  let want = on, why;
  if (t >= rule.onAt) { want = true; why = `t=${t} >= ${rule.onAt}`; }
  else if (t <= rule.offAt) { want = false; why = `t=${t} <= ${rule.offAt}`; }
  else why = `${rule.offAt} < t=${t} < ${rule.onAt}: giu trang thai`;
  if (want !== on) {
    if (ctx.lastCmdAt && now - ctx.lastCmdAt < rule.minGapMs) return { decision: 'hold', reason: `${why}; cho du ${rule.minGapMs / 1000} s giua hai lenh` };
    return { decision: want ? 'on' : 'off', reason: why };
  }
  // Đang bật do luật: gia hạn để node không tự tắt vì hết lease
  if (on && tele.fan?.by === 'auto' && (!ctx.lastOnAt || now - ctx.lastOnAt >= rule.renewMs))
    return { decision: 'renew', reason: `${why}; gia han lease ${rule.leaseS} s` };
  return { decision: 'hold', reason: why };
}

export function commandFor(decision, rule = RULE) {
  if (decision === 'on' || decision === 'renew') return { ledG: 1, src: 'auto', lease: rule.leaseS };
  if (decision === 'off') return { ledG: 0, src: 'auto' };
  return null;
}
