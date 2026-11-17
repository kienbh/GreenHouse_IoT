// Bài 6-8: bảng của dịch vụ app trong cùng file SQLite với bảng mqtt_messages (Bài 5)
//  commands  vòng đời từng lệnh theo cmd_id: pending -> applied | rejected | duplicate | timeout
//  audit     ai làm gì, lúc nào, từ đâu, kết quả (kể cả bị từ chối)
//  rule_log  mỗi lần luật tự động đánh giá: số đo, lý do, quyết định (Bài 7)
//  settings  chế độ tự động/thủ công của từng thiết bị (giữ qua khởi động lại)
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openAppDb(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS commands (
      cmd_id TEXT PRIMARY KEY, dev TEXT NOT NULL, user TEXT NOT NULL, role TEXT NOT NULL, src TEXT NOT NULL,
      payload TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT, sends INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, reason TEXT, ack_at TEXT, ack_payload TEXT, latency_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS commands_dev_time ON commands(dev, created_at);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, at TEXT NOT NULL, user TEXT, role TEXT, ip TEXT, action TEXT NOT NULL,
      dev TEXT, cmd_id TEXT, detail TEXT, result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rule_log (
      id INTEGER PRIMARY KEY, at TEXT NOT NULL, dev TEXT NOT NULL, rule TEXT NOT NULL, mode TEXT NOT NULL,
      t REAL, data_age_ms INTEGER, fan INTEGER, decision TEXT NOT NULL, reason TEXT NOT NULL, cmd_id TEXT, test INTEGER
    );
    CREATE INDEX IF NOT EXISTS rule_log_dev_time ON rule_log(dev, at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const iso = (ts = Date.now()) => new Date(ts).toISOString();
  const q = {
    cmdInsert: db.prepare(`INSERT INTO commands (cmd_id, dev, user, role, src, payload, created_at, status)
                           VALUES (@cmd_id, @dev, @user, @role, @src, @payload, @created_at, 'pending')`),
    cmdSent: db.prepare('UPDATE commands SET sent_at = ?, sends = sends + 1 WHERE cmd_id = ?'),
    cmdStatus: db.prepare(`UPDATE commands SET status = @status, reason = @reason, ack_at = @ack_at,
                           ack_payload = @ack_payload, latency_ms = @latency_ms WHERE cmd_id = @cmd_id`),
    cmdGet: db.prepare('SELECT * FROM commands WHERE cmd_id = ?'),
    cmdList: db.prepare('SELECT * FROM commands WHERE dev = ? ORDER BY created_at DESC LIMIT ?'),
    audit: db.prepare(`INSERT INTO audit (at, user, role, ip, action, dev, cmd_id, detail, result)
                       VALUES (@at, @user, @role, @ip, @action, @dev, @cmd_id, @detail, @result)`),
    auditList: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
    rule: db.prepare(`INSERT INTO rule_log (at, dev, rule, mode, t, data_age_ms, fan, decision, reason, cmd_id, test)
                      VALUES (@at, @dev, @rule, @mode, @t, @data_age_ms, @fan, @decision, @reason, @cmd_id, @test)`),
    ruleList: db.prepare('SELECT * FROM rule_log WHERE dev = ? ORDER BY id DESC LIMIT ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };
  return {
    iso,
    insertCommand: (c) => q.cmdInsert.run({ ...c, created_at: iso(c.created_at) }),
    markSent: (id, ts) => q.cmdSent.run(iso(ts), id),
    setCommandStatus: (c) => q.cmdStatus.run({ reason: null, ack_at: null, ack_payload: null, latency_ms: null, ...c }),
    getCommand: (id) => q.cmdGet.get(id),
    listCommands: (dev, limit = 30) => q.cmdList.all(dev, limit),
    audit: (a) => q.audit.run({ at: iso(), user: null, role: null, ip: null, dev: null, cmd_id: null, detail: null, ...a }),
    listAudit: (limit = 100) => q.auditList.all(limit),
    ruleLog: (r) => q.rule.run({ at: iso(), cmd_id: null, t: null, data_age_ms: null, fan: null, test: 0, ...r }),
    listRuleLog: (dev, limit = 50) => q.ruleList.all(dev, limit),
    getSetting: (k, dflt = null) => q.getSetting.get(k)?.value ?? dflt,
    setSetting: (k, v) => q.setSetting.run(k, String(v)),
    close() { if (db.open) db.close(); },
  };
}
