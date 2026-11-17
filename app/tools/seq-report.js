// Bài 9: đối chiếu theo MÃ BẢN GHI (boot, seq) trong bảng mqtt_messages (Bài 5), không đếm dòng log.
//   node tools/seq-report.js <thiết-bị> <từ ISO> [đến ISO]
// In: số phát sinh (theo dải seq), nhận duy nhất, mất, trùng, gửi bù; các khoảng seq bị mất.
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function seqReport(db, dev, from, to = new Date().toISOString(), base = 'vju/nhakinh') {
  const rows = db.prepare(`
    SELECT received_at, CAST(payload AS TEXT) AS p FROM mqtt_messages
    WHERE topic = ? AND received_at >= ? AND received_at <= ? ORDER BY id`).all(`${base}/${dev}/telemetry`, from, to);
  const boots = new Map();
  for (const r of rows) {
    let j; try { j = JSON.parse(r.p); } catch { continue; }
    if (!Number.isInteger(j.seq)) continue;
    const b = boots.get(j.boot) || { seqs: new Map(), replay: 0, live: 0 };
    boots.set(j.boot, b);
    b.seqs.set(j.seq, (b.seqs.get(j.seq) || 0) + 1);
    if (j.replay) b.replay++; else b.live++;
  }
  return [...boots].map(([boot, b]) => {
    const list = [...b.seqs.keys()].sort((x, y) => x - y);
    const lo = list[0], hi = list.at(-1), missing = [];
    for (let s = lo, i = 0; s <= hi; s++) { if (list[i] === s) i++; else missing.push(s); }
    const gaps = [];
    for (const s of missing) { const g = gaps.at(-1); if (g && g[1] === s - 1) g[1] = s; else gaps.push([s, s]); }
    const total = [...b.seqs.values()].reduce((a, n) => a + n, 0);
    return { boot, seq_from: lo, seq_to: hi, generated: hi - lo + 1, received_unique: list.length, lost: missing.length,
             duplicates: total - list.length, replayed: b.replay, live: b.live, gaps: gaps.map(([a, z]) => (a === z ? `${a}` : `${a}-${z}`)) };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dev, from, to] = process.argv.slice(2);
  if (!dev || !from) { console.log('Dung: node tools/seq-report.js <thiet-bi> <tu ISO> [den ISO]'); process.exit(1); }
  const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const db = new Database(process.env.DB || path.join(DIR, 'data', 'mqtt.sqlite'), { readonly: true });
  console.table(seqReport(db, dev, from, to));
}
