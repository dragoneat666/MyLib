// routes/items.js — /api/items

import { Router } from 'express';
import multer from 'multer';
import { getDb } from '../db.js';
import {
  present, getItem, getOrCreateCollection, fieldsFromMetadata, sanitizeFields, insertItem, updateItem, findOwned,
} from '../items.js';
import { fetchCoverForItem, saveCover, deleteCover, queueCovers } from '../covers.js';
import { lookupIsbn } from '../metadata/index.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Sort by title ignoring a leading "The", "A" or "An".
const TITLE_SORT = `(CASE WHEN i.title LIKE 'the %' THEN substr(i.title, 5)
                          WHEN i.title LIKE 'an %' THEN substr(i.title, 4)
                          WHEN i.title LIKE 'a %' THEN substr(i.title, 3)
                          ELSE i.title END) COLLATE NOCASE`;
const SORTS = {
  title: [TITLE_SORT],
  author: ['i.last_name COLLATE NOCASE', 'i.first_name COLLATE NOCASE', TITLE_SORT],
  added: ['i.added', 'i.created_at', 'i.id'],
  published: ['i.publish_date', TITLE_SORT],
  series: ['i.series COLLATE NOCASE', "CAST(NULLIF(i.volume, '') AS REAL)", 'i.publish_date', TITLE_SORT],
  rating: ['CAST(i.rating AS REAL)', TITLE_SORT],
};

// GET /api/items?collection=&q=&sort=title|author|added|published|series|rating&dir=asc|desc&status=&limit=&offset=
router.get('/', (req, res) => {
  const where = [];
  const params = [];
  const { collection, q, status, tag, missing } = req.query;

  if (collection) {
    where.push('i.collection_id = ?');
    params.push(Number(collection));
  }
  if (status) {
    if (status === 'none') where.push("(i.status IS NULL OR i.status = '')");
    else {
      where.push('i.status = ?');
      params.push(status);
    }
  }
  if (tag) {
    where.push("(',' || REPLACE(i.tags, ', ', ',') || ',') LIKE ?");
    params.push(`%,${tag},%`);
  }
  if (missing === 'cover') where.push('i.cover_file IS NULL');
  if (missing === 'isbn') where.push("(i.ean_isbn13 IS NULL OR i.ean_isbn13 = '')");
  for (const term of String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    const like = `%${term.replace(/[%_]/g, (m) => '\\' + m)}%`;
    where.push(`(i.title LIKE ? ESCAPE '\\' OR i.creators LIKE ? ESCAPE '\\' OR i.series LIKE ? ESCAPE '\\'
                 OR i.tags LIKE ? ESCAPE '\\' OR i.publisher LIKE ? ESCAPE '\\' OR i.notes LIKE ? ESCAPE '\\'
                 OR i.ean_isbn13 = ? OR i.upc_isbn10 = ?)`);
    params.push(like, like, like, like, like, like, term.replace(/-/g, ''), term.replace(/-/g, '').toUpperCase());
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const order = (SORTS[req.query.sort] || SORTS.title).map((s) => `${s} ${dir}`).join(', ');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM items i ${whereSql}`).get(...params).n;
  const items = db
    .prepare(`SELECT i.id, i.collection_id, c.name AS collection_name, i.item_type, i.title, i.creators,
                     i.first_name, i.last_name, i.ean_isbn13, i.upc_isbn10, i.publisher, i.publish_date,
                     i.status, i.rating, i.tags, i.copies, i.series, i.volume, i.added, i.cover_file, i.length
              FROM items i JOIN collections c ON c.id = i.collection_id
              ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ total, items: items.map(present) });
});

// GET /api/items/owned?isbn=… — "do we already have this book?"
router.get('/owned', (req, res) => {
  res.json({ owned: findOwned(req.query.isbn || '') });
});

// GET /api/items/tags — every tag in use, for filters and autocomplete
router.get('/tags', (_req, res) => {
  const counts = new Map();
  for (const { tags } of getDb().prepare("SELECT tags FROM items WHERE tags IS NOT NULL AND tags != ''").all()) {
    for (const t of tags.split(',').map((s) => s.trim()).filter(Boolean)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  res.json({ tags: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)) });
});

router.get('/:id', (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(present(item));
});

// POST /api/items
// Body: { collection_id | collection_name, metadata?: <lookup result>, ...item fields, fetch_cover?: true }
router.post('/', async (req, res) => {
  const body = req.body || {};
  let collectionId = Number(body.collection_id) || null;
  if (!collectionId) {
    if (!body.collection_name) return res.status(400).json({ error: 'Choose a collection' });
    collectionId = getOrCreateCollection(body.collection_name).collection.id;
  } else if (!getDb().prepare('SELECT 1 FROM collections WHERE id = ?').get(collectionId)) {
    return res.status(400).json({ error: 'Collection not found' });
  }
  // Fields typed by the user win over the looked-up metadata.
  const fields = sanitizeFields(fieldsFromMetadata(body.metadata || {}));
  for (const [k, v] of Object.entries(sanitizeFields(body))) if (v != null) fields[k] = v;
  for (const k of Object.keys(fields)) if (fields[k] == null) delete fields[k];
  if (!fields.title) return res.status(400).json({ error: 'Title is required' });

  const id = insertItem(collectionId, fields);
  const item = getItem(id);
  if (body.fetch_cover !== false && (item.cover_url || item.ean_isbn13)) {
    // Try right away so the new book shows its cover; fall back to the queue.
    try {
      await Promise.race([fetchCoverForItem(item), new Promise((r) => setTimeout(r, 8000))]);
    } catch {
      queueCovers([id]);
    }
  }
  res.status(201).json(present(getItem(id)));
});

router.put('/:id', (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const fields = sanitizeFields(req.body || {});
  if ('title' in fields && !fields.title) return res.status(400).json({ error: 'Title is required' });
  if (req.body?.collection_id) fields.collection_id = Number(req.body.collection_id);
  updateItem(item.id, fields);
  res.json(present(getItem(item.id)));
});

// POST /api/items/:id/copies { delta: 1 } — quick "+1 copy" from the scanner
router.post('/:id/copies', (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const copies = Math.max(0, (item.copies || 0) + (parseInt(req.body?.delta, 10) || 1));
  updateItem(item.id, { copies });
  res.json(present(getItem(item.id)));
});

router.delete('/:id', (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.cover_file) deleteCover(item);
  getDb().prepare('DELETE FROM items WHERE id = ?').run(item.id);
  res.json({ ok: true });
});

// POST /api/items/:id/cover — upload a photo (multipart "cover") or { url } to download
router.post('/:id/cover', upload.single('cover'), async (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (req.file) {
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'That file is not an image' });
    saveCover(item, req.file.buffer, req.file.mimetype);
  } else {
    const url = req.body?.url;
    if (url) updateItem(item.id, { cover_url: url });
    const file = await fetchCoverForItem(url ? { ...item, cover_url: url } : item);
    if (!file) return res.status(404).json({ error: 'No cover image found' });
  }
  res.json(present(getItem(item.id)));
});

router.delete('/:id/cover', (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  deleteCover(item);
  res.json(present(getItem(item.id)));
});

// POST /api/items/:id/refresh { overwrite: false } — re-download metadata by ISBN.
// By default only empty fields are filled in.
router.post('/:id/refresh', async (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const isbn = item.ean_isbn13 || item.upc_isbn10;
  if (!isbn) return res.status(400).json({ error: 'This item has no ISBN to look up' });
  const meta = await lookupIsbn(isbn);
  if (!meta) return res.status(404).json({ error: 'No information found for this ISBN' });
  const incoming = sanitizeFields(fieldsFromMetadata(meta));
  const overwrite = !!req.body?.overwrite;
  const changes = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null || k === 'item_type') continue;
    if (overwrite || item[k] == null || item[k] === '') changes[k] = v;
  }
  updateItem(item.id, changes);
  const updated = getItem(item.id);
  if (!updated.cover_file) await fetchCoverForItem(updated).catch(() => null);
  res.json({ item: present(getItem(item.id)), changed: Object.keys(changes) });
});

// POST /api/items/bulk { ids: [], action: 'move'|'delete'|'status'|'add_tag'|'fetch_covers', collection_id, status, tag }
router.post('/bulk', (req, res) => {
  const { ids = [], action } = req.body || {};
  const list = ids.map(Number).filter(Boolean);
  if (!list.length) return res.status(400).json({ error: 'No items selected' });
  const db = getDb();
  const marks = list.map(() => '?').join(', ');
  switch (action) {
    case 'move': {
      const target = Number(req.body.collection_id);
      if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(target)) return res.status(400).json({ error: 'Collection not found' });
      db.prepare(`UPDATE items SET collection_id = ?, updated_at = datetime('now') WHERE id IN (${marks})`).run(target, ...list);
      break;
    }
    case 'delete':
      db.transaction(() => {
        for (const item of db.prepare(`SELECT * FROM items WHERE id IN (${marks})`).all(...list)) {
          if (item.cover_file) deleteCover(item);
        }
        db.prepare(`DELETE FROM items WHERE id IN (${marks})`).run(...list);
      })();
      break;
    case 'status':
      db.prepare(`UPDATE items SET status = ?, updated_at = datetime('now') WHERE id IN (${marks})`).run(req.body.status || null, ...list);
      break;
    case 'add_tag': {
      const tag = String(req.body.tag || '').trim();
      if (!tag) return res.status(400).json({ error: 'Tag is required' });
      const stmt = db.prepare("UPDATE items SET tags = ?, updated_at = datetime('now') WHERE id = ?");
      db.transaction(() => {
        for (const item of db.prepare(`SELECT id, tags FROM items WHERE id IN (${marks})`).all(...list)) {
          const tags = (item.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
          if (!tags.includes(tag)) stmt.run([...tags, tag].join(', '), item.id);
        }
      })();
      break;
    }
    case 'fetch_covers':
      queueCovers(list);
      break;
    default:
      return res.status(400).json({ error: 'Unknown action' });
  }
  res.json({ ok: true, count: list.length });
});

export default router;
