// routes/collections.js — /api/collections

import { Router } from 'express';
import { getDb } from '../db.js';
import { deleteCover } from '../covers.js';

const router = Router();

router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(`SELECT c.id, c.name, c.description, c.created_at,
                     COUNT(i.id) AS item_count, COALESCE(SUM(i.copies), 0) AS copy_count,
                     MAX(i.created_at) AS last_added
              FROM collections c LEFT JOIN items i ON i.collection_id = c.id
              GROUP BY c.id ORDER BY c.name COLLATE NOCASE`)
    .all();
  // A few covers per collection for the shelf preview on the home page.
  const coverStmt = db.prepare(
    `SELECT cover_file FROM items WHERE collection_id = ? AND cover_file IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 4`
  );
  res.json({
    collections: rows.map((c) => ({ ...c, covers: coverStmt.all(c.id).map((r) => `/covers/${r.cover_file}`) })),
  });
});

router.get('/:id', (req, res) => {
  const c = getDb()
    .prepare(`SELECT c.*, COUNT(i.id) AS item_count, COALESCE(SUM(i.copies), 0) AS copy_count
              FROM collections c LEFT JOIN items i ON i.collection_id = c.id WHERE c.id = ? GROUP BY c.id`)
    .get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Collection not found' });
  res.json(c);
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const info = getDb()
      .prepare('INSERT INTO collections (name, description) VALUES (?, ?)')
      .run(name, req.body?.description || null);
    res.json({ id: Number(info.lastInsertRowid), name });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'A collection with that name already exists' });
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    getDb()
      .prepare('UPDATE collections SET name = ?, description = ? WHERE id = ?')
      .run(name, req.body?.description || null, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'A collection with that name already exists' });
    throw err;
  }
});

// DELETE /api/collections/:id?move_to=<id>   — move its items first
// DELETE /api/collections/:id?delete_items=1 — delete the items too
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const count = db.prepare('SELECT COUNT(*) AS n FROM items WHERE collection_id = ?').get(id).n;
  const moveTo = req.query.move_to ? Number(req.query.move_to) : null;
  if (count && !moveTo && req.query.delete_items !== '1') {
    return res.status(400).json({ error: `This collection still has ${count} items. Move or delete them first.` });
  }
  if (moveTo === id) return res.status(400).json({ error: "Can't move items into the collection being deleted" });
  db.transaction(() => {
    if (count && moveTo) {
      db.prepare("UPDATE items SET collection_id = ?, updated_at = datetime('now') WHERE collection_id = ?").run(moveTo, id);
    } else if (count) {
      for (const item of db.prepare('SELECT * FROM items WHERE collection_id = ? AND cover_file IS NOT NULL').all(id)) {
        deleteCover(item);
      }
    }
    db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

export default router;
