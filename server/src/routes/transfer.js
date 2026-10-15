// routes/transfer.js — Libib CSV import, CSV/SQL export and backups.
//   POST /api/import/libib
//   GET  /api/export/csv[?collection_id=]
//   GET  /api/export/sql
//   GET  /api/backups, POST /api/backups/run, GET /api/backups/download/:file, POST /api/backups/restore

import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db.js';
import { parseLibibCsv, rowToItem } from '../libib.js';
import { getOrCreateCollection, insertItem, updateItem } from '../items.js';
import { queueCovers, coverQueueStatus } from '../covers.js';
import { sqlDump, libraryCsv, localDate, runBackup, listBackups, restoreFromSql } from '../backup.js';
import { config } from '../config.js';

export const importRouter = Router();
export const exportRouter = Router();
export const backupRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection';

// ── Import ───────────────────────────────────────────────────────────────────
// multipart fields:
//   file          the Libib CSV
//   mode          "csv"    → use the CSV's collection column (default)
//                 "single" → put everything in one collection
//   collection_id / new_collection   target for "single" mode (or fallback for rows without a collection)
//   duplicates    "skip" (default) | "update" | "add"
//   fetch_covers  "true" to download covers in the background
//   dry_run       "true" to only report what would happen
class DryRun extends Error {}

importRouter.post('/libib', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a CSV file to import' });
  let rows;
  try {
    rows = parseLibibCsv(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: `Couldn't read that CSV: ${err.message}` });
  }

  const opts = req.body || {};
  const mode = opts.mode === 'single' ? 'single' : 'csv';
  const duplicates = ['update', 'add'].includes(opts.duplicates) ? opts.duplicates : 'skip';
  const dryRun = opts.dry_run === 'true';
  const db = getDb();

  let fixedCollection = null;
  if (opts.collection_id) {
    fixedCollection = db.prepare('SELECT * FROM collections WHERE id = ?').get(Number(opts.collection_id));
    if (!fixedCollection) return res.status(400).json({ error: 'Collection not found' });
  }
  if (mode === 'single' && !fixedCollection && !String(opts.new_collection || '').trim()) {
    return res.status(400).json({ error: 'Choose a collection to import into' });
  }

  const summary = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [], collections: {} };
  const touched = [];

  const bySource = db.prepare('SELECT id FROM items WHERE source_id = ?');
  const byMylibId = db.prepare('SELECT id FROM items WHERE id = ?');
  const byIsbn = db.prepare('SELECT id FROM items WHERE collection_id = ? AND (ean_isbn13 = ? OR upc_isbn10 = ?)');
  const byTitle = db.prepare('SELECT id FROM items WHERE collection_id = ? AND title = ? COLLATE NOCASE AND IFNULL(creators, \'\') = ?');

  const work = db.transaction(() => {
    rows.forEach((row, index) => {
      try {
        const { collection: csvCollection, sourceId, fields } = rowToItem(row);
        if (!fields.title) {
          summary.skipped++;
          summary.errors.push({ row: index + 2, error: 'Missing title' });
          return;
        }
        let target;
        if (mode === 'single') {
          target = fixedCollection
            ? { collection: fixedCollection, created: false }
            : getOrCreateCollection(opts.new_collection);
        } else {
          target = csvCollection
            ? getOrCreateCollection(csvCollection)
            : fixedCollection
              ? { collection: fixedCollection, created: false }
              : getOrCreateCollection(opts.new_collection || 'Imported');
        }
        const c = target.collection;
        const entry = (summary.collections[c.name] ??= { name: c.name, new: target.created, created: 0, updated: 0, skipped: 0 });
        if (target.created) entry.new = true;

        let existing = null;
        if (duplicates !== 'add') {
          const mylibId = sourceId?.match(/^mylib-(\d+)$/)?.[1];
          existing =
            (sourceId && bySource.get(sourceId)) ||
            (mylibId && byMylibId.get(Number(mylibId))) ||
            ((fields.ean_isbn13 || fields.upc_isbn10) &&
              byIsbn.get(c.id, fields.ean_isbn13 || '-', fields.upc_isbn10 || '-')) ||
            (!fields.ean_isbn13 && byTitle.get(c.id, fields.title, fields.creators || '')) ||
            null;
        }

        if (existing && duplicates === 'skip') {
          summary.skipped++;
          entry.skipped++;
        } else if (existing && duplicates === 'update') {
          const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
          updateItem(existing.id, { ...changes, collection_id: c.id });
          if (sourceId && !sourceId.startsWith('mylib-')) {
            db.prepare('UPDATE items SET source_id = ? WHERE id = ?').run(sourceId, existing.id);
          }
          summary.updated++;
          entry.updated++;
          touched.push(existing.id);
        } else {
          const id = insertItem(c.id, fields, sourceId && !sourceId.startsWith('mylib-') ? sourceId : null);
          summary.created++;
          entry.created++;
          touched.push(id);
        }
      } catch (err) {
        summary.skipped++;
        summary.errors.push({ row: index + 2, error: err.message });
      }
    });
    if (dryRun) throw new DryRun();
  });

  try {
    work();
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
  }

  summary.collections = Object.values(summary.collections);
  summary.dry_run = dryRun;
  summary.errors = summary.errors.slice(0, 50);
  if (!dryRun && opts.fetch_covers === 'true' && touched.length) {
    const missing = touched.filter((id) => !db.prepare('SELECT cover_file FROM items WHERE id = ?').get(id)?.cover_file);
    queueCovers(missing);
    summary.covers_queued = missing.length;
  }
  res.json(summary);
});

importRouter.get('/covers/status', (_req, res) => res.json(coverQueueStatus()));

// ── Export ───────────────────────────────────────────────────────────────────
exportRouter.get('/csv', (req, res) => {
  const id = req.query.collection_id ? Number(req.query.collection_id) : null;
  let name = 'all';
  if (id) {
    const c = getDb().prepare('SELECT name FROM collections WHERE id = ?').get(id);
    if (!c) return res.status(404).json({ error: 'Collection not found' });
    name = slug(c.name);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mylib_${name}_${localDate()}.csv"`);
  // BOM so Excel opens accented characters correctly
  res.send('﻿' + libraryCsv(id));
});

exportRouter.get('/sql', (_req, res) => {
  res.setHeader('Content-Type', 'application/sql; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mylib_${localDate()}.sql"`);
  res.send(sqlDump());
});

// ── Backups ──────────────────────────────────────────────────────────────────
backupRouter.get('/', (_req, res) => {
  res.json({ backups: listBackups(), dir: config.backupDir, schedule: config.backupCron, keepDays: config.backupKeepDays });
});

backupRouter.post('/run', (_req, res) => {
  res.json(runBackup());
});

backupRouter.get('/download/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(config.backupDir, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Backup not found' });
  res.download(full, file);
});

backupRouter.post('/restore', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a .sql backup file' });
  const result = await restoreFromSql(req.file.buffer.toString('utf8'));
  res.json({ ok: true, ...result });
});
