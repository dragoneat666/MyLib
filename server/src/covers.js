// covers.js — cover images are downloaded once and kept in DATA_DIR/covers so
// the library doesn't depend on outside sites staying up.

import fs from 'fs';
import path from 'path';
import { getDb } from './db.js';
import { config } from './config.js';
import { fetchImage } from './metadata/http.js';
import { coverByIsbn } from './metadata/openlibrary.js';
import * as google from './metadata/googlebooks.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export function coverFilePath(file) {
  return path.join(config.coversDir, path.basename(file));
}

function removeOld(item) {
  if (item.cover_file) fs.rm(coverFilePath(item.cover_file), { force: true }, () => {});
}

export function saveCover(item, buffer, contentType) {
  const ext = EXT[contentType] || 'jpg';
  // A fresh name each time so browsers/phones never show a stale cached cover.
  const file = `${item.id}-${Date.now().toString(36)}.${ext}`;
  fs.mkdirSync(config.coversDir, { recursive: true });
  fs.writeFileSync(coverFilePath(file), buffer);
  removeOld(item);
  getDb().prepare("UPDATE items SET cover_file = ?, updated_at = datetime('now') WHERE id = ?").run(file, item.id);
  return file;
}

export function deleteCover(item) {
  removeOld(item);
  getDb().prepare("UPDATE items SET cover_file = NULL, updated_at = datetime('now') WHERE id = ?").run(item.id);
}

// Try the item's own cover_url, then Open Library by ISBN, then Google Books.
export async function fetchCoverForItem(item) {
  const candidates = [];
  if (item.cover_url) candidates.push(item.cover_url);
  if (item.ean_isbn13) candidates.push(coverByIsbn(item.ean_isbn13));
  if (item.upc_isbn10) candidates.push(coverByIsbn(item.upc_isbn10));
  for (const url of candidates) {
    try {
      const img = await fetchImage(url);
      if (img) return saveCover(item, img.buffer, img.contentType);
    } catch {
      // try the next source
    }
  }
  if (google.enabled() && item.ean_isbn13) {
    try {
      const hit = await google.lookupIsbn(item.ean_isbn13);
      const img = hit?.cover_url && (await fetchImage(hit.cover_url));
      if (img) return saveCover(item, img.buffer, img.contentType);
    } catch {
      // no cover available
    }
  }
  return null;
}

// ── Background queue (used after imports and when adding books) ─────────────
const queue = [];
const status = { running: false, total: 0, done: 0, found: 0 };

export function coverQueueStatus() {
  return { ...status, pending: queue.length };
}

export function queueCovers(itemIds) {
  const fresh = itemIds.filter((id) => !queue.includes(id));
  if (!fresh.length) return;
  if (!status.running) Object.assign(status, { total: 0, done: 0, found: 0 });
  queue.push(...fresh);
  status.total += fresh.length;
  if (!status.running) runQueue();
}

async function runQueue() {
  status.running = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      const item = getDb().prepare('SELECT * FROM items WHERE id = ?').get(id);
      if (item && !item.cover_file && (await fetchCoverForItem(item))) status.found++;
    } catch (err) {
      console.warn(`cover fetch failed for item ${id}: ${err.message}`);
    }
    status.done++;
    // Be polite to Open Library.
    await new Promise((r) => setTimeout(r, 350));
  }
  status.running = false;
}
