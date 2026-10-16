// backup.js — nightly SQL dump + CSV export, and restore from a SQL dump.
//
// Files land in BACKUP_DIR (mount it to a folder on the host) as
//   mylib_YYYY-MM-DD.sql  — the whole database as plain SQL (sqlite3-compatible)
//   mylib_YYYY-MM-DD.csv  — the whole library in Libib's CSV format
// so a script on the host can copy them to Dropbox.

import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { getDb, closeDb, initDb, migrate } from './db.js';
import { itemsToCsv } from './libib.js';

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function sqlDump(db = getDb()) {
  const out = [
    `-- MyLib database dump`,
    `-- Created ${new Date().toISOString()}`,
    `-- Restore from MyLib's Backups page, or with: sqlite3 mylib.db < this-file.sql`,
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;',
  ];
  const tables = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
    .all();
  for (const { name, sql } of tables) {
    out.push(`${sql};`);
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
    const colList = cols.map((c) => `"${c}"`).join(',');
    for (const row of db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).raw().iterate()) {
      out.push(`INSERT INTO "${name}" (${colList}) VALUES(${row.map(sqlValue).join(',')});`);
    }
  }
  for (const { sql } of db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()) {
    out.push(`${sql};`);
  }
  out.push(`PRAGMA user_version=${db.pragma('user_version', { simple: true })};`);
  out.push('COMMIT;', '');
  return out.join('\n');
}

// collectionId: a collection id, 'unsorted' for New & Unsorted, or null for everything.
// Unsorted books have an empty "collection" column.
export function libraryCsv(collectionId = null) {
  const db = getDb();
  const where = collectionId === 'unsorted' ? 'WHERE i.collection_id IS NULL' : collectionId ? 'WHERE i.collection_id = ?' : '';
  const items = db
    .prepare(`SELECT i.*, c.name AS collection_name FROM items i LEFT JOIN collections c ON c.id = i.collection_id
              ${where} ORDER BY c.name IS NULL, c.name COLLATE NOCASE, i.title COLLATE NOCASE`)
    .all(...(collectionId && collectionId !== 'unsorted' ? [collectionId] : []));
  return itemsToCsv(items);
}

// Local date in the configured time zone, e.g. 2026-10-15
export function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function runBackup() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = localDate();
  const sqlFile = path.join(config.backupDir, `mylib_${stamp}.sql`);
  const csvFile = path.join(config.backupDir, `mylib_${stamp}.csv`);
  // Write to a temp name first so the Dropbox script never picks up a half-written file.
  fs.writeFileSync(sqlFile + '.tmp', sqlDump());
  fs.renameSync(sqlFile + '.tmp', sqlFile);
  fs.writeFileSync(csvFile + '.tmp', libraryCsv());
  fs.renameSync(csvFile + '.tmp', csvFile);
  pruneBackups();
  console.log(`💾 Backup written: ${path.basename(sqlFile)}, ${path.basename(csvFile)}`);
  return { sql: path.basename(sqlFile), csv: path.basename(csvFile) };
}

function pruneBackups() {
  if (!config.backupKeepDays || config.backupKeepDays <= 0) return;
  const cutoff = Date.now() - config.backupKeepDays * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(config.backupDir)) {
    if (!/^(mylib_|pre-restore_)/.test(f)) continue;
    const p = path.join(config.backupDir, f);
    if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
  }
}

export function listBackups() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs
    .readdirSync(config.backupDir)
    .filter((f) => /\.(sql|csv|db)$/.test(f))
    .map((f) => {
      const stat = fs.statSync(path.join(config.backupDir, f));
      return { file: f, size: stat.size, modified: stat.mtime.toISOString(), type: path.extname(f).slice(1) };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

// Replace the whole database with the contents of a SQL dump.
// A copy of the current database is saved first as pre-restore_<time>.db.
// Older dumps (with the removed login tables) are upgraded by migrate().
export async function restoreFromSql(sql) {
  if (!/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?items"?/i.test(sql)) {
    throw Object.assign(new Error("This file doesn't look like a MyLib SQL backup"), { status: 400 });
  }
  const tmp = `${config.dbFile}.restore`;
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });

  const test = new Database(tmp);
  try {
    test.exec(sql);
    migrate(test);
    test.prepare('SELECT COUNT(*) FROM items').get();
    test.prepare('SELECT COUNT(*) FROM collections').get();
  } catch (err) {
    test.close();
    fs.rmSync(tmp, { force: true });
    throw Object.assign(new Error(`Restore failed: ${err.message}`), { status: 400 });
  }
  test.close();

  fs.mkdirSync(config.backupDir, { recursive: true });
  const safety = path.join(config.backupDir, `pre-restore_${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await getDb().backup(safety);

  closeDb();
  for (const f of [`${config.dbFile}-wal`, `${config.dbFile}-shm`]) fs.rmSync(f, { force: true });
  fs.renameSync(tmp, config.dbFile);
  initDb();
  return { safetyCopy: path.basename(safety) };
}

export function startBackupSchedule() {
  if (!cron.validate(config.backupCron)) {
    console.warn(`⚠️  BACKUP_CRON "${config.backupCron}" is not a valid cron expression — nightly backups disabled`);
    return;
  }
  cron.schedule(
    config.backupCron,
    () => {
      try {
        runBackup();
      } catch (err) {
        console.error('Nightly backup failed:', err);
      }
    },
    { timezone: config.timezone }
  );
  console.log(`⏰ Backups scheduled (${config.backupCron}, ${config.timezone}) → ${config.backupDir}`);
}
