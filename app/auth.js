// Bài 6 (kiểm quyền tối thiểu) + Bài 8 (RBAC): tài khoản người dùng app, phiên đăng nhập, ma trận vai–quyền.
// Mật khẩu chỉ lưu dạng băm scrypt trong users.json (gitignored). Quyền kiểm tại SERVER cho mọi API,
// giao diện chỉ ẩn/khóa nút cho tiện, không phải lớp bảo vệ.
import crypto from 'node:crypto';
import fs from 'node:fs';

export const ROLES = ['viewer', 'operator', 'admin'];
// Hành động -> vai được phép
export const PERMISSIONS = {
  view:      ['viewer', 'operator', 'admin'],  // xem dashboard, dữ liệu, lịch sử lệnh, nhật ký luật
  control:   ['operator', 'admin'],            // LED, dải LED, chạy/dừng bơm, âm thanh, chế độ tự động/thủ công, BẬT khóa an toàn
  configure: ['admin'],                        // ngưỡng, công suất/thời gian bơm, chu kỳ gửi, dữ liệu thử, giả lập mất mạng, MỞ khóa, JSON tự do
  audit:     ['admin'],                        // xem nhật ký truy vết
};
const CONTROL_KEYS = new Set(['ledR', 'ledG', 'ledArray', 'cmd', 'pump', 'play', 'stop']);

export function can(role, action) { return !!PERMISSIONS[action]?.includes(role); }

// Lệnh cần quyền gì: chỉ toàn khóa điều khiển thông thường -> control; có khóa cấu hình/lạ -> configure.
// Bật khóa an toàn ({"lock":1}) ai điều khiển được cũng bấm được; mở khóa ({"lock":0}) chỉ admin.
export function actionFor(cmd) {
  const keys = Object.keys(cmd);
  if (keys.length === 1 && keys[0] === 'lock') return Number(cmd.lock) ? 'control' : 'configure';
  return keys.length && keys.every((k) => CONTROL_KEYS.has(k)) ? 'control' : 'configure';
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [kind, salt, hex] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hex) return false;
  const a = Buffer.from(hex, 'hex'), b = crypto.scryptSync(String(password), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createAuth({ usersFile, sessionMs = 8 * 3600e3, maxFails = 5, lockMs = 60e3, now = Date.now }) {
  const sessions = new Map();   // token -> { user, role, exp }
  const fails = new Map();      // user|ip -> { n, until }
  const users = () => { try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch { return {}; } };
  return {
    users,
    hasUsers: () => Object.keys(users()).length > 0,
    // Trả { token, user, role } hoặc { error }
    login(name, password, ip) {
      const key = `${name}|${ip}`, f = fails.get(key);
      if (f && f.until > now()) return { error: 'tam khoa do sai nhieu lan, thu lai sau', locked: true };
      const u = users()[name];
      if (!u || !verifyPassword(password, u.hash) || !ROLES.includes(u.role)) {
        const n = (f?.n || 0) + 1;
        fails.set(key, { n, until: n >= maxFails ? now() + lockMs : 0 });
        return { error: 'sai tai khoan hoac mat khau' };
      }
      fails.delete(key);
      const token = crypto.randomBytes(24).toString('base64url');
      sessions.set(token, { user: name, role: u.role, exp: now() + sessionMs });
      return { token, user: name, role: u.role };
    },
    session(token) {
      const s = token && sessions.get(token);
      if (!s) return null;
      if (s.exp < now()) { sessions.delete(token); return null; }
      return s;
    },
    logout(token) { sessions.delete(token); },
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
