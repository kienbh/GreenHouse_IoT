// Bài 9: sao lưu SQLite khi app ĐANG CHẠY (API backup trực tuyến của SQLite, an toàn với WAL) và THỬ KHÔI PHỤC.
//   node tools/backup.js backup                -> backups/mqtt-<thời điểm>.sqlite (+ sha256)
//   node tools/backup.js verify <file-backup>  -> khôi phục vào thư mục thử riêng, chạy cùng truy vấn trên bản gốc
//                                                  và bản khôi phục trong cùng khoảng thời gian, so sánh kết quả
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.DB || path.join(DIR, 'data', 'mqtt.sqlite');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Truy vấn đối chiếu: theo topic trong khoảng [from, to] – số bản tin, id đầu/cuối, tổng kiểm payload
function fingerprint(db, from, to) {
  return db.prepare(`SELECT topic, COUNT(*) AS n, MIN(id) AS first_id, MAX(id) AS last_id,
                       SUM(length(payload)) AS bytes, MIN(received_at) AS first_at, MAX(received_at) AS last_at
                     FROM mqtt_messages WHERE received_at BETWEEN ? AND ? GROUP BY topic ORDER BY topic`).all(from, to);
}

const [cmd, file] = process.argv.slice(2);
if (cmd === 'backup') {
  const dir = path.join(DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `mqtt-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  const db = new Database(SRC, { readonly: true });
  const t0 = Date.now();
  await db.backup(out);
  const rows = new Database(out, { readonly: true }).prepare('SELECT COUNT(*) n, MAX(received_at) last FROM mqtt_messages').get();
  fs.writeFileSync(out + '.sha256', `${sha(out)}  ${path.basename(out)}\n`);
  console.log(`Sao luu xong sau ${Date.now() - t0} ms: ${path.relative(DIR, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${rows.n} ban tin, moi nhat ${rows.last})`);
  console.log(`sha256 ${sha(out)}`);
} else if (cmd === 'verify' && file) {
  const want = fs.existsSync(file + '.sha256') ? fs.readFileSync(file + '.sha256', 'utf8').split(' ')[0] : null;
  if (want && want !== sha(file)) { console.log('SAI tong kiem sha256: ban sao luu bi hong'); process.exit(2); }
  // Khôi phục vào thư mục thử riêng (không đè lên dữ liệu đang chạy)
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhakinh-restore-'));
  const restored = path.join(testDir, 'mqtt.sqlite');
  fs.copyFileSync(file, restored);
  const r = new Database(restored, { readonly: true });
  const integrity = r.pragma('integrity_check', { simple: true });
  const { last } = r.prepare('SELECT MAX(received_at) AS last FROM mqtt_messages').get();
  const from = new Date(Date.parse(last) - 3600e3).toISOString();   // 1 giờ cuối có trong bản sao lưu
  const a = fingerprint(new Database(SRC, { readonly: true }), from, last), b = fingerprint(r, from, last);
  console.log(`Khoi phuc vao ${restored}; integrity_check = ${integrity}; sha256 ${want ? 'khop' : 'khong co file .sha256'}`);
  console.log(`Doi chieu khoang ${from} .. ${last}:`);
  console.table(a.map((x, i) => ({ topic: x.topic, goc: x.n, khoi_phuc: b[i]?.n, bytes_goc: x.bytes, bytes_kp: b[i]?.bytes, khop: JSON.stringify(x) === JSON.stringify(b[i]) ? 'co' : 'KHONG' })));
  const ok = integrity === 'ok' && JSON.stringify(a) === JSON.stringify(b);
  console.log(ok ? 'KET QUA: ban khoi phuc khop ban goc tren cung khoang du lieu' : 'KET QUA: KHONG KHOP');
  process.exit(ok ? 0 : 1);
} else {
  console.log('Dung: node tools/backup.js backup | verify <file-backup>');
}
