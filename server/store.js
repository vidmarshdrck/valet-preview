import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_PERSONALITY } from './personalities.js';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      personality TEXT NOT NULL DEFAULT '${DEFAULT_PERSONALITY}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pair_codes (
      code_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      personality TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      agenda TEXT NOT NULL,
      participants TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meeting_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      speaker TEXT NOT NULL,
      source TEXT NOT NULL,
      owner_agent_id TEXT,
      deadline TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const columns = db.prepare('PRAGMA table_info(messages)').all();
  if (!columns.some((column) => column.name === 'conversation_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN conversation_id TEXT');
  }
  const loose = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id IS NULL OR conversation_id = ''").get();
  if (loose.n > 0) {
    const now = Date.now();
    const first = db.prepare("SELECT text, created_at FROM messages WHERE role = 'user' ORDER BY id LIMIT 1").get();
    const title = first && String(first.text).trim() ? String(first.text).trim().slice(0, 80) : 'Earlier chat';
    db.prepare('INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run('earlier', title, first?.created_at || now, now);
    db.prepare("UPDATE messages SET conversation_id = 'earlier' WHERE conversation_id IS NULL OR conversation_id = ''").run();
  }
  return db;
}

export function wipeOwnerData(db) {
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM pair_codes;
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM meeting_entries;
    DELETE FROM meetings;
    DELETE FROM tasks;
    DELETE FROM events;
  `);
}
