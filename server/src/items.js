// items.js — shared item/collection helpers used by several routes.

import { getDb } from './db.js';
import { ITEM_FIELDS, splitName } from './libib.js';
import { normalizeIsbn, cleanIsbn } from './metadata/isbn.js';
import { normalizeTagField } from './tags.js';

// Books with no collection yet (collection_id NULL) show up as "New & Unsorted".
export const UNSORTED_NAME = 'New & Unsorted';

export function coverUrl(item) {
  return item.cover_file ? `/covers/${item.cover_file}` : null;
}

export function present(item) {
  if (!item) return item;
  return { ...item, collection_name: item.collection_name ?? UNSORTED_NAME, cover: coverUrl(item) };
}

export function getItem(id) {
  return getDb()
    .prepare('SELECT i.*, c.name AS collection_name FROM items i LEFT JOIN collections c ON c.id = i.collection_id WHERE i.id = ?')
    .get(id);
}

export function findCollectionByName(name) {
  return getDb().prepare('SELECT * FROM collections WHERE name = ?').get(String(name).trim());
}

export function getOrCreateCollection(name) {
  const clean = String(name || '').trim();
  if (!clean) return { collection: null, created: false };
  const existing = findCollectionByName(clean);
  if (existing) return { collection: existing, created: false };
  const info = getDb().prepare('INSERT INTO collections (name) VALUES (?)').run(clean);
  return { collection: { id: Number(info.lastInsertRowid), name: clean }, created: true };
}

const isUnsortedValue = (v) => v == null || v === '' || v === 0 || v === '0' || v === 'unsorted';

// Work out the target collection from { collection_id | collection_name }.
// Returns { id } where id null means New & Unsorted, or { error }.
export function resolveCollection(body = {}) {
  if (!isUnsortedValue(body.collection_id)) {
    const id = Number(body.collection_id);
    if (!getDb().prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) return { error: 'Collection not found' };
    return { id };
  }
  if (body.collection_name && String(body.collection_name).trim()) {
    return { id: getOrCreateCollection(body.collection_name).collection.id };
  }
  return { id: null };
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
    volume: meta.volume || null,
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
    else if (key === 'tags') v = normalizeTagField(v);
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

// collectionId null = New & Unsorted
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

const OWNED_COLUMNS = `i.id, i.title, i.creators, i.copies, i.tags, i.collection_id,
  COALESCE(c.name, '${UNSORTED_NAME.replace(/'/g, "''")}') AS collection_name, i.cover_file`;

// Which books already have this ISBN (in any collection)? Used to warn "you already own this".
export function findOwned(isbn) {
  const ids = normalizeIsbn(isbn);
  const values = ids ? [ids.isbn13, ids.isbn10].filter(Boolean) : [cleanIsbn(isbn)];
  if (!values[0]) return [];
  const marks = values.map(() => '?').join(', ');
  return getDb()
    .prepare(`SELECT ${OWNED_COLUMNS} FROM items i LEFT JOIN collections c ON c.id = i.collection_id
              WHERE i.ean_isbn13 IN (${marks}) OR i.upc_isbn10 IN (${marks}) ORDER BY i.id`)
    .all(...values, ...values)
    .map((r) => ({ ...r, cover: coverUrl(r) }));
}

// "Is this book already in MyLib?" — same ISBN anywhere, or for books without
// an ISBN, the same title and author anywhere.
export function findDuplicate(fields) {
  const isbn = fields.ean_isbn13 || fields.upc_isbn10;
  if (isbn) return findOwned(isbn)[0] || null;
  if (!fields.title) return null;
  const row = getDb()
    .prepare(`SELECT ${OWNED_COLUMNS} FROM items i LEFT JOIN collections c ON c.id = i.collection_id
              WHERE i.title = ? COLLATE NOCASE AND IFNULL(i.creators, '') = ? COLLATE NOCASE ORDER BY i.id LIMIT 1`)
    .get(fields.title, fields.creators || '');
  return row ? { ...row, cover: coverUrl(row) } : null;
}
