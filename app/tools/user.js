// Quản lý tài khoản người dùng app (Bài 8). users.json chỉ chứa băm scrypt, nằm trong .gitignore.
//   node tools/user.js init                 -> tạo 3 tài khoản mẫu xem/van-hanh/quan-tri, mật khẩu ngẫu nhiên
//   node tools/user.js add <tên> <vai> [mk] -> thêm/đổi; vai: viewer | operator | admin; không ghi mk thì sinh ngẫu nhiên
//   node tools/user.js del <tên>
//   node tools/user.js list
// Mật khẩu chỉ in ra MỘT LẦN và ghi vào data/accounts-app.local (chmod 600) để giảng viên phát cho nhóm.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword, ROLES } from '../auth.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.USERS_FILE || path.join(DIR, 'users.json');
const NOTE = path.join(DIR, 'data', 'accounts-app.local');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const save = (u) => { fs.writeFileSync(FILE, JSON.stringify(u, null, 2) + '\n', { mode: 0o600 }); fs.chmodSync(FILE, 0o600); };
const randomPass = () => crypto.randomBytes(12).toString('base64url');
function note(name, role, pass) {
  fs.mkdirSync(path.dirname(NOTE), { recursive: true });
  const lines = fs.existsSync(NOTE) ? fs.readFileSync(NOTE, 'utf8').split('\n').filter((l) => l && !l.startsWith(name + ' ')) : [];
  lines.push(`${name} ${role} ${pass}`);
  fs.writeFileSync(NOTE, lines.join('\n') + '\n', { mode: 0o600 });
}
function add(name, role, pass = randomPass()) {
  if (!/^[a-z0-9_-]{2,32}$/.test(name)) throw new Error('ten chi gom a-z 0-9 _ -');
  if (!ROLES.includes(role)) throw new Error(`vai phai la ${ROLES.join(' | ')}`);
  const u = load();
  u[name] = { role, hash: hashPassword(pass), changed: new Date().toISOString() };
  save(u); note(name, role, pass);
  console.log(`${name.padEnd(10)} ${role.padEnd(9)} ${pass}`);
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'init') {
  console.log('Tai khoan (mat khau chi hien mot lan, da ghi vao data/accounts-app.local):');
  add('xem', 'viewer'); add('van-hanh', 'operator'); add('quan-tri', 'admin');
} else if (cmd === 'add' && a && b) add(a, b, c);
else if (cmd === 'del' && a) { const u = load(); delete u[a]; save(u); console.log('Da xoa', a); }
else if (cmd === 'list') for (const [n, v] of Object.entries(load())) console.log(n.padEnd(10), v.role.padEnd(9), v.changed);
else console.log('Dung: node tools/user.js init | add <ten> <viewer|operator|admin> [mat-khau] | del <ten> | list');
