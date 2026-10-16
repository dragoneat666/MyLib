// routes/transfer.js — Libib CSV import, CSV/SQL export and backups.
//   POST /api/import/libib, POST /api/import/resolve
//   GET  /api/export/csv[?collection_id=]
//   GET  /api/export/sql
//   GET  /api/backups, POST /api/backups/run, GET /api/backups/download/:file, POST /api/backups/restore

import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db.js';
import { parseLibibCsv, rowToItem } from '../libib.js';
import { getOrCreateCollection, insertItem, updateItem, findDuplicate, sanitizeFields, getItem, UNSORTED_NAME } from '../items.js';
import { normalizeTagField, changeItemTags, parseTags } from '../tags.js';
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
//   mode          "csv"    → use the CSV's collection column (default; rows without one go to New & Unsorted)
//                 "single" → put everything in one collection
//   collection_id / new_collection   target for "single" mode ("unsorted" = New & Unsorted)
//   duplicates    what to do when a book is already in MyLib (same ISBN, any collection):
//                 "ask" (default) → import the rest and return the duplicates as `conflicts`
//                                   for the user to decide (POST /api/import/resolve)
//                 "ignore" | "copy" (add another copy) | "replace" (update its details)
//   fetch_covers  "true" to download covers in the background
//   dry_run       "true" to only report what would happen
//
// Rows with the same Libib ID as a book already imported are the same record,
// not another copy, so they're skipped silently (or updated in "replace" mode).
class DryRun extends Error {}

const DUPLICATE_MODES = ['ask', 'ignore', 'copy', 'replace'];
const libibId = (sourceId) => (sourceId && !sourceId.startsWith('mylib-') ? sourceId : null);
const nonNull = (fields) => Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));

// "Replacement copy": the book keeps its place and copy count; its details come from the import.
function replaceDetails(existingId, fields) {
  const { copies, added, ...rest } = nonNull(fields);
  updateItem(existingId, rest);
}

function addCopies(existingId, fields) {
  getDb()
    .prepare("UPDATE items SET copies = copies + ?, updated_at = datetime('now') WHERE id = ?")
    .run(Math.max(1, fields.copies || 1), existingId);
  if (fields.tags) changeItemTags([existingId], { add: parseTags(fields.tags) });
}

function rememberDecision(sourceId, itemId, decision) {
  const id = libibId(sourceId);
  if (!id) return;
  getDb()
    .prepare(`INSERT INTO import_seen (source_id, item_id, decision) VALUES (?, ?, ?)
              ON CONFLICT(source_id) DO UPDATE SET item_id = excluded.item_id, decision = excluded.decision`)
    .run(id, itemId, decision);
}

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
  const duplicates = DUPLICATE_MODES.includes(opts.duplicates) ? opts.duplicates : 'ask';
  const dryRun = opts.dry_run === 'true';
  const db = getDb();

  let fixedCollection = null; // null = New & Unsorted
  const unsortedTarget = ['unsorted', '0'].includes(String(opts.collection_id ?? ''));
  if (opts.collection_id && !unsortedTarget) {
    fixedCollection = db.prepare('SELECT * FROM collections WHERE id = ?').get(Number(opts.collection_id));
    if (!fixedCollection) return res.status(400).json({ error: 'Collection not found' });
  }

  const summary = {
    total: rows.length, created: 0, updated: 0, skipped: 0, already_imported: 0,
    copies_added: 0, replaced: 0, ignored: 0, errors: [], collections: {}, conflicts: [],
  };
  const touched = [];

  const bySource = db.prepare('SELECT id FROM items WHERE source_id = ?');
  const byMylibId = db.prepare('SELECT id FROM items WHERE id = ?');
  const seen = db.prepare('SELECT item_id FROM import_seen WHERE source_id = ?');

  const work = db.transaction(() => {
    rows.forEach((row, index) => {
      try {
        const { collection: csvCollection, sourceId, fields } = rowToItem(row);
        if (!fields.title) {
          summary.skipped++;
          summary.errors.push({ row: index + 2, error: 'Missing title' });
          return;
        }
        if (fields.tags) fields.tags = normalizeTagField(fields.tags);

        let target;
        if (mode === 'single') {
          target = fixedCollection
            ? { collection: fixedCollection, created: false }
            : getOrCreateCollection(unsortedTarget ? '' : opts.new_collection);
        } else {
          target = csvCollection ? getOrCreateCollection(csvCollection) : { collection: fixedCollection, created: false };
        }
        const c = target.collection; // null = New & Unsorted
        const name = c?.name ?? UNSORTED_NAME;
        const entry = (summary.collections[name] ??= { name, new: false, created: 0, updated: 0, skipped: 0 });
        if (target.created) entry.new = true;

        // 1. The same Libib record imported before?
        const mylibId = sourceId?.match(/^mylib-(\d+)$/)?.[1];
        const same =
          (libibId(sourceId) && (bySource.get(sourceId) || seen.get(sourceId))) ||
          (mylibId && byMylibId.get(Number(mylibId))) ||
          null;
        if (same) {
          const sameId = same.id ?? same.item_id;
          if (duplicates === 'replace' && sameId && byMylibId.get(sameId)) {
            replaceDetails(sameId, fields);
            summary.updated++;
            entry.updated++;
            touched.push(sameId);
          } else {
            summary.already_imported++;
            entry.skipped++;
          }
          return;
        }

        // 2. Another copy of a book that's already in MyLib (any collection)?
        const existing = findDuplicate(fields);
        if (existing) {
          if (duplicates === 'ask') {
            summary.conflicts.push({
              row: index + 2,
              source_id: libibId(sourceId),
              fields,
              target_collection: name,
              existing,
            });
          } else if (duplicates === 'ignore') {
            summary.ignored++;
            entry.skipped++;
            rememberDecision(sourceId, existing.id, 'ignore');
          } else if (duplicates === 'copy') {
            addCopies(existing.id, fields);
            summary.copies_added++;
            entry.updated++;
            rememberDecision(sourceId, existing.id, 'copy');
          } else {
            replaceDetails(existing.id, fields);
            summary.replaced++;
            entry.updated++;
            touched.push(existing.id);
            rememberDecision(sourceId, existing.id, 'replace');
          }
          return;
        }

        // 3. A new book.
        const id = insertItem(c?.id ?? null, fields, libibId(sourceId));
        summary.created++;
        entry.created++;
        touched.push(id);
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

// POST /api/import/resolve — the user's answers for the duplicates an "ask" import found.
// Body: { decisions: [{ action: 'copy'|'replace'|'ignore', existing_id, source_id?, fields, tags?: [..] }] }
// `tags` (the "retag it" picker) replaces the book's tags; otherwise the file's tags are added.
importRouter.post('/resolve', (req, res) => {
  const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
  const db = getDb();
  const result = { copies_added: 0, replaced: 0, ignored: 0, errors: [] };
  db.transaction(() => {
    for (const d of decisions) {
      const existingId = Number(d.existing_id);
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(existingId)) {
        result.errors.push({ existing_id: d.existing_id, error: 'Book not found' });
        continue;
      }
      const fields = sanitizeFields(d.fields || {});
      if (d.action === 'copy') {
        addCopies(existingId, fields);
        result.copies_added++;
      } else if (d.action === 'replace') {
        delete fields.tags;
        replaceDetails(existingId, fields);
        if (Array.isArray(d.tags)) changeItemTags([existingId], { remove: parseTags(getItem(existingId).tags), add: d.tags });
        else if (d.fields?.tags) changeItemTags([existingId], { add: parseTags(d.fields.tags) });
        result.replaced++;
      } else {
        result.ignored++;
      }
      rememberDecision(d.source_id, existingId, d.action === 'copy' || d.action === 'replace' ? d.action : 'ignore');
    }
  })();
  res.json(result);
});

importRouter.get('/covers/status', (_req, res) => res.json(coverQueueStatus()));

// ── Export ───────────────────────────────────────────────────────────────────
exportRouter.get('/csv', (req, res) => {
  const unsorted = req.query.collection_id === 'unsorted';
  const id = unsorted ? 'unsorted' : req.query.collection_id ? Number(req.query.collection_id) : null;
  let name = unsorted ? 'new-and-unsorted' : 'all';
  if (id && !unsorted) {
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
