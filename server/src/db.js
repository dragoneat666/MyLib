// db.js — SQLite database (one file in DATA_DIR) with simple versioned migrations.
//
// Everything goes through getDb() rather than a module-level constant so a
// restore can swap the database file underneath the running server.

import fs from 'fs';
import Database from 'better-sqlite3';
import { config } from './config.js';

let db = null;

// Each entry upgrades the schema by one version (PRAGMA user_version).
const MIGRATIONS = [
  // v1 — initial schema. Item columns mirror Libib's CSV export so imports and
  // exports round-trip without losing anything.
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE tokens (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    name         TEXT,
    kind         TEXT NOT NULL DEFAULT 'session',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );

  CREATE TABLE collections (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE items (
    id                INTEGER PRIMARY KEY,
    collection_id     INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    source_id         TEXT,
    item_type         TEXT NOT NULL DEFAULT 'book',
    title             TEXT NOT NULL,
    creators          TEXT,
    first_name        TEXT,
    last_name         TEXT,
    ean_isbn13        TEXT,
    upc_isbn10        TEXT,
    description       TEXT,
    publisher         TEXT,
    publish_date      TEXT,
    item_group        TEXT,
    tags              TEXT,
    notes             TEXT,
    price             TEXT,
    length            TEXT,
    number_of_discs   TEXT,
    number_of_players TEXT,
    age_group         TEXT,
    ensemble          TEXT,
    aspect_ratio      TEXT,
    esrb              TEXT,
    rating            TEXT,
    review            TEXT,
    review_date       TEXT,
    status            TEXT,
    began             TEXT,
    completed         TEXT,
    added             TEXT,
    copies            INTEGER NOT NULL DEFAULT 1,
    series            TEXT,
    volume            TEXT,
    cover_url         TEXT,
    cover_file        TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_items_collection ON items(collection_id);
  CREATE INDEX idx_items_isbn13     ON items(ean_isbn13);
  CREATE INDEX idx_items_isbn10     ON items(upc_isbn10);
  CREATE INDEX idx_items_source     ON items(source_id);
  CREATE INDEX idx_items_title      ON items(title COLLATE NOCASE);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  `,
  // v2 — logins removed: MyLib is only reachable on the home network / NetBird.
  `
  DROP TABLE IF EXISTS tokens;
  DROP TABLE IF EXISTS users;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(database) {
  const current = database.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    database.transaction(() => {
      database.exec(MIGRATIONS[v]);
      database.pragma(`user_version = ${v + 1}`);
    })();
    console.log(`📚 Database migrated to schema v${v + 1}`);
  }
}

export function openDb(file = config.dbFile) {
  const database = new Database(file);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  migrate(database);
  return database;
}

export function initDb() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.coversDir, { recursive: true });
  db = openDb();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialised');
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// Settings helpers (small key/value store)
export function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value));
}
