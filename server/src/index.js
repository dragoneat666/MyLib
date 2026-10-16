// index.js — MyLib server: JSON API under /api, cover images under /covers,
// and the built React web app for everything else.

import fs from 'fs';
import path from 'path';
import express from 'express';
import { config } from './config.js';
import { initDb, getDb, SCHEMA_VERSION } from './db.js';
import collectionsRouter from './routes/collections.js';
import itemsRouter from './routes/items.js';
import lookupRouter from './routes/lookup.js';
import { importRouter, exportRouter, backupRouter } from './routes/transfer.js';
import tagsRouter from './routes/tags.js';
import { UNSORTED_NAME } from './items.js';
import { startBackupSchedule } from './backup.js';
import { providers } from './metadata/index.js';

initDb();

const app = express();
app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const start = Date.now();
    res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`));
  }
  next();
});

app.get('/health', (_req, res) => {
  getDb().prepare('SELECT 1').get();
  res.json({ status: 'ok', version: config.version });
});

app.use('/api/collections', collectionsRouter);
app.use('/api/items', itemsRouter);
app.use('/api/lookup', lookupRouter);
app.use('/api/import', importRouter);
app.use('/api/export', exportRouter);
app.use('/api/backups', backupRouter);
app.use('/api/tags', tagsRouter);

app.get('/api/stats', (_req, res) => {
  const db = getDb();
  const totals = db
    .prepare('SELECT COUNT(*) AS items, COALESCE(SUM(copies), 0) AS copies, COUNT(DISTINCT collection_id) AS used FROM items')
    .get();
  const collections = db.prepare('SELECT COUNT(*) AS n FROM collections').get().n;
  const statuses = db
    .prepare("SELECT COALESCE(NULLIF(status, ''), 'Not set') AS status, COUNT(*) AS n FROM items GROUP BY 1 ORDER BY 2 DESC")
    .all();
  const recent = db
    .prepare(`SELECT i.id, i.title, i.creators, i.cover_file, i.collection_id, c.name AS collection_name
              FROM items i LEFT JOIN collections c ON c.id = i.collection_id ORDER BY i.created_at DESC, i.id DESC LIMIT 12`)
    .all()
    .map((i) => ({ ...i, collection_name: i.collection_name ?? UNSORTED_NAME, cover: i.cover_file ? `/covers/${i.cover_file}` : null }));
  res.json({ items: totals.items, copies: totals.copies, collections, statuses, recent });
});

app.get('/api/info', (_req, res) => {
  res.json({
    version: config.version,
    schema: SCHEMA_VERSION,
    providers: providers(),
    apk: fs.existsSync(config.apkFile),
  });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Cover images
app.use('/covers', express.static(config.coversDir, { maxAge: '30d', immutable: true, fallthrough: false }));

// Android app download
app.get('/download/mylib.apk', (_req, res) => {
  if (!fs.existsSync(config.apkFile)) return res.status(404).send('The Android app is not included in this build.');
  res.download(config.apkFile, 'mylib.apk');
});

// React web app
if (fs.existsSync(config.webDir)) {
  app.use(express.static(config.webDir, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.webDir, 'index.html'));
  });
}

// Errors
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is too large' });
  res.status(status).json({ error: status >= 500 ? `Server error: ${err.message}` : err.message });
});

app.listen(config.port, () => {
  console.log(`📚 MyLib ${config.version} listening on port ${config.port}`);
  console.log(`   data: ${config.dataDir}   backups: ${config.backupDir}`);
  const p = providers();
  console.log(`   metadata: Open Library${p.google ? ', Google Books' : ''}${p.isbndb ? ', ISBNdb' : ''}${p.ai ? ', Claude cover reading' : ''}`);
  startBackupSchedule();
});
