// tags.js — the shared tag list.
//
// Books store tags as "Christmas, Signed" in items.tags (Libib's format). The
// tags table is the list of tags to pick from; every tag saved on a book is
// matched to it case-insensitively, so "christmas" becomes "Christmas".

import { getDb } from './db.js';

export function parseTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const name = String(raw).trim().replace(/\s+/g, ' ').slice(0, 60);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

export const tagsToString = (list) => (list.length ? list.join(', ') : null);

// Map names to the tag list's spelling, adding any new ones to the list.
export function registerTags(names) {
  const db = getDb();
  const find = db.prepare('SELECT name FROM tags WHERE name = ?');
  const insert = db.prepare('INSERT INTO tags (name) VALUES (?)');
  return parseTags(names).map((name) => {
    const existing = find.get(name);
    if (existing) return existing.name;
    insert.run(name);
    return name;
  });
}

// Normalise a tags value from a request/import into the stored string.
export const normalizeTagField = (value) => tagsToString(registerTags(parseTags(value)));

export function listTags() {
  const db = getDb();
  const counts = new Map();
  for (const { tags } of db.prepare("SELECT tags FROM items WHERE tags IS NOT NULL AND tags != ''").all()) {
    for (const t of parseTags(tags)) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) || 0) + 1);
  }
  return db
    .prepare('SELECT id, name FROM tags ORDER BY name COLLATE NOCASE')
    .all()
    .map((t) => ({ ...t, count: counts.get(t.name.toLowerCase()) || 0 }));
}

// Rewrite the tags of every book matching `filter(lowercaseNames)`.
function rewriteItems(names, change) {
  const db = getDb();
  const lowered = names.map((n) => n.toLowerCase());
  const update = db.prepare("UPDATE items SET tags = ?, updated_at = datetime('now') WHERE id = ?");
  for (const item of db.prepare("SELECT id, tags FROM items WHERE tags IS NOT NULL AND tags != ''").all()) {
    const current = parseTags(item.tags);
    if (!current.some((t) => lowered.includes(t.toLowerCase()))) continue;
    update.run(tagsToString(parseTags(change(current))), item.id);
  }
}

export function renameTag(id, newName) {
  const db = getDb();
  const name = parseTags(newName)[0];
  if (!name) throw Object.assign(new Error('Tag name is required'), { status: 400 });
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  if (!tag) throw Object.assign(new Error('Tag not found'), { status: 404 });
  db.transaction(() => {
    const other = db.prepare('SELECT * FROM tags WHERE name = ? AND id != ?').get(name, id);
    if (other) {
      // Renaming onto an existing tag merges the two.
      db.prepare('DELETE FROM tags WHERE id = ?').run(id);
      rewriteItems([tag.name], (list) => list.map((t) => (t.toLowerCase() === tag.name.toLowerCase() ? other.name : t)));
    } else {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id);
      rewriteItems([tag.name], (list) => list.map((t) => (t.toLowerCase() === tag.name.toLowerCase() ? name : t)));
    }
  })();
}

export function deleteTag(id) {
  const db = getDb();
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  if (!tag) return;
  db.transaction(() => {
    rewriteItems([tag.name], (list) => list.filter((t) => t.toLowerCase() !== tag.name.toLowerCase()));
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  })();
}

// Add and/or remove tags on some books.
export function changeItemTags(itemIds, { add = [], remove = [] } = {}) {
  const db = getDb();
  const adding = registerTags(add);
  const removing = parseTags(remove).map((t) => t.toLowerCase());
  const get = db.prepare('SELECT tags FROM items WHERE id = ?');
  const update = db.prepare("UPDATE items SET tags = ?, updated_at = datetime('now') WHERE id = ?");
  db.transaction(() => {
    for (const id of itemIds) {
      const row = get.get(id);
      if (!row) continue;
      const next = parseTags([...parseTags(row.tags).filter((t) => !removing.includes(t.toLowerCase())), ...adding]);
      update.run(tagsToString(next), id);
    }
  })();
}
