// items.js — shared item/collection helpers used by several routes.

import { getDb } from './db.js';
import { ITEM_FIELDS, splitName } from './libib.js';
import { normalizeIsbn, cleanIsbn } from './metadata/isbn.js';

export function coverUrl(item) {
  return item.cover_file ? `/covers/${item.cover_file}` : null;
}

export function present(item) {
  if (!item) return item;
  return { ...item, cover: coverUrl(item) };
}

export function getItem(id) {
  return getDb()
    .prepare('SELECT i.*, c.name AS collection_name FROM items i JOIN collections c ON c.id = i.collection_id WHERE i.id = ?')
    .get(id);
}

export function findCollectionByName(name) {
  return getDb().prepare('SELECT * FROM collections WHERE name = ?').get(String(name).trim());
}

export function getOrCreateCollection(name) {
  const clean = String(name || '').trim() || 'Unsorted';
  const existing = findCollectionByName(clean);
  if (existing) return { collection: existing, created: false };
  const info = getDb().prepare('INSERT INTO collections (name) VALUES (?)').run(clean);
  return { collection: { id: Number(info.lastInsertRowid), name: clean }, created: true };
}

// Convert a metadata lookup result (from /api/lookup) into item columns.
export function fieldsFromMetadata(meta = {}) {
  const authors = meta.authors || [];
  const { first_name, last_name } = splitName(authors[0]);
  const title = meta.subtitle && meta.title && !meta.title.includes(meta.subtitle)
    ? `${meta.title}: ${meta.subtitle}`
    : meta.title;
  return {
    item_type: 'book',
    title,
    creators: authors.join(', ') || null,
    first_name,
    last_name,
    ean_isbn13: meta.isbn13 || null,
    upc_isbn10: meta.isbn10 || null,
    description: meta.description || null,
    publisher: meta.publisher || null,
    publish_date: meta.publish_date || null,
    length: meta.pages ? String(meta.pages) : null,
    series: meta.series || null,
    cover_url: meta.cover_url || null,
  };
}

// Keep only known columns and tidy up values.
export function sanitizeFields(body = {}) {
  const out = {};
  for (const key of ITEM_FIELDS) {
    if (!(key in body)) continue;
    let v = body[key];
    if (v === '' || v === undefined) v = null;
    if (key === 'copies') v = Math.max(0, parseInt(v, 10) || 0);
    else if (v != null) v = String(v);
    out[key] = v;
  }
  for (const key of ['ean_isbn13', 'upc_isbn10']) {
    if (out[key]) out[key] = cleanIsbn(out[key]) || null;
  }
  // Fill the other ISBN form if only one was given.
  const ids = normalizeIsbn(out.ean_isbn13) || normalizeIsbn(out.upc_isbn10);
  if (ids) {
    if ('ean_isbn13' in out || 'upc_isbn10' in out) {
      out.ean_isbn13 = out.ean_isbn13 || ids.isbn13;
      out.upc_isbn10 = out.upc_isbn10 || ids.isbn10;
    }
  }
  if ('creators' in out && !('last_name' in body) && out.creators) {
    Object.assign(out, splitName(out.creators.split(',')[0]));
  }
  return out;
}

export function insertItem(collectionId, fields, sourceId = null) {
  const cols = Object.keys(fields);
  const today = new Date().toISOString().slice(0, 10);
  const data = { added: today, copies: 1, item_type: 'book', ...fields };
  if (!data.title) throw Object.assign(new Error('Title is required'), { status: 400 });
  const keys = [...new Set(['collection_id', 'source_id', ...cols, 'added', 'copies', 'item_type'])];
  const values = keys.map((k) => (k === 'collection_id' ? collectionId : k === 'source_id' ? sourceId : data[k] ?? null));
  const info = getDb()
    .prepare(`INSERT INTO items (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...values);
  return Number(info.lastInsertRowid);
}

export function updateItem(id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  getDb()
    .prepare(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), id);
}

// Which collections already hold this ISBN? Used to warn "you already own this".
export function findOwned(isbn) {
  const ids = normalizeIsbn(isbn);
  const values = ids ? [ids.isbn13, ids.isbn10].filter(Boolean) : [cleanIsbn(isbn)];
  if (!values[0]) return [];
  const marks = values.map(() => '?').join(', ');
  return getDb()
    .prepare(`SELECT i.id, i.title, i.copies, i.collection_id, c.name AS collection_name, i.cover_file
              FROM items i JOIN collections c ON c.id = i.collection_id
              WHERE i.ean_isbn13 IN (${marks}) OR i.upc_isbn10 IN (${marks})`)
    .all(...values, ...values)
    .map((r) => ({ ...r, cover: coverUrl(r) }));
}
