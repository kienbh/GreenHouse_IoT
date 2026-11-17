// Lưu nguyên từng bản tin MQTT nhận được, kể cả payload lặp hoặc JSON lỗi.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openMessageStore(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS mqtt_messages (
      id INTEGER PRIMARY KEY,
      received_at TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload BLOB NOT NULL,
      qos INTEGER NOT NULL,
      retain INTEGER NOT NULL,
      dup INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mqtt_messages_topic_time
      ON mqtt_messages(topic, received_at);
  `);
  const insert = db.prepare(`
    INSERT INTO mqtt_messages (received_at, topic, payload, qos, retain, dup)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return {
    append(topic, payload, packet = {}, receivedAt = Date.now()) {
      return insert.run(new Date(receivedAt).toISOString(), topic, payload,
        packet.qos ?? 0, packet.retain ? 1 : 0, packet.dup ? 1 : 0).lastInsertRowid;
    },
    close() { if (db.open) db.close(); },
  };
}
