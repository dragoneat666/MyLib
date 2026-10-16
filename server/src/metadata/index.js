// metadata/index.js — finds book details from the configured sources.
//
// Book-detail sources are asked ONE AT A TIME in the order chosen in
// Settings (default: Open Library, Hardcover, Google Books, ISBNdb), stopping
// as soon as the book has a title, author, cover and description. Each source
// counts its calls and stops at its daily limit (usage.js).
//
// Extras (not in the order):
//   NYT Books — marks books that were NYT bestsellers (NYT_API_KEY)
//   Claude    — reads cover photos (ANTHROPIC_API_KEY)

import * as openlibrary from './openlibrary.js';
import * as hardcover from './hardcover.js';
import * as google from './googlebooks.js';
import * as isbndb from './isbndb.js';
import * as nyt from './nyt.js';
import * as ai from './ai.js';
import { normalizeIsbn } from './isbn.js';
import { usageSummary } from './usage.js';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';

export const SOURCES = [
  { id: 'openlibrary', name: 'Open Library', module: openlibrary, env: null, key: () => null },
  { id: 'hardcover', name: 'Hardcover', module: hardcover, env: 'HARDCOVER_API_TOKEN', key: () => config.hardcoverToken },
  { id: 'google', name: 'Google Books', module: google, env: 'GOOGLE_BOOKS_API_KEY', key: () => config.googleBooksKey },
  { id: 'isbndb', name: 'ISBNdb', module: isbndb, env: 'ISBNDB_API_KEY', key: () => config.isbndbKey },
];
const DEFAULT_ORDER = SOURCES.map((s) => s.id);
const configured = (s) => !s.env || !!s.key();

const readJson = (key, fallback) => {
  try {
    return JSON.parse(getSetting(key, '')) ?? fallback;
  } catch {
    return fallback;
  }
};

// The saved order, with any sources it doesn't mention added at the end.
export function sourceOrder() {
  const saved = readJson('source_order', []).filter((id) => DEFAULT_ORDER.includes(id));
  return [...new Set([...saved, ...DEFAULT_ORDER])];
}
const sourcesOff = () => new Set(readJson('sources_off', []));
const nytOn = () => nyt.enabled() && !sourcesOff().has('nyt');
export const nytTagOn = () => getSetting('nyt_tag', '1') === '1';

// Sources that will actually be asked, in order.
export function activeSources() {
  const off = sourcesOff();
  return sourceOrder().map((id) => SOURCES.find((s) => s.id === id)).filter((s) => configured(s) && !off.has(s.id));
}

export function saveSourceSettings({ order, off, nyt_tag }) {
  if (Array.isArray(order)) setSetting('source_order', JSON.stringify(order.filter((id) => DEFAULT_ORDER.includes(id))));
  if (Array.isArray(off)) setSetting('sources_off', JSON.stringify(off.filter((id) => [...DEFAULT_ORDER, 'nyt', 'ai'].includes(id))));
  if (nyt_tag != null) setSetting('nyt_tag', nyt_tag ? '1' : '0');
}

export function providers() {
  return {
    openlibrary: true,
    hardcover: hardcover.enabled(),
    google: google.enabled(),
    isbndb: isbndb.enabled(),
    nyt: nyt.enabled(),
    ai: ai.enabled(),
  };
}

// "AIzaSyB…x9Qw" — enough to tell which key is loaded without showing it.
const mask = (key) => (key ? `${key.replace(/^bearer\s+/i, '').slice(0, 6)}…${key.slice(-4)}` : null);

export function providerDetails() {
  const off = sourcesOff();
  const metadata = sourceOrder().map((id) => {
    const s = SOURCES.find((x) => x.id === id);
    return {
      id, name: s.name, kind: 'metadata', enabled: configured(s), on: !off.has(id),
      key: mask(s.key()), env: s.env, usage: usageSummary(id),
    };
  });
  return [
    ...metadata,
    { id: 'nyt', name: 'NYT Books (bestsellers)', kind: 'extra', enabled: nyt.enabled(), on: !off.has('nyt'),
      key: mask(config.nytKey), env: 'NYT_API_KEY', usage: usageSummary('nyt'), tag: nytTagOn() },
    { id: 'ai', name: 'Claude cover reading', kind: 'extra', enabled: ai.enabled(), on: !off.has('ai'),
      key: mask(config.anthropicKey), env: 'ANTHROPIC_API_KEY' },
  ];
}

// Test book: Magic Tree House #1, Dinosaurs Before Dark.
export const TEST_ISBN = '9780679824114';

// Make one real request to a source and report what happened.
export async function testProvider(id) {
  const details = providerDetails().find((p) => p.id === id);
  if (!details) return { ok: false, message: 'Unknown source' };
  if (!details.enabled) return { ok: false, message: `No key set. Add ${details.env} to the .env file and restart the container.` };
  const started = Date.now();
  try {
    if (id === 'ai') {
      const model = await ai.checkKey();
      return { ok: true, message: `Key works — ${model} is available.`, ms: Date.now() - started };
    }
    if (id === 'nyt') {
      const info = await nyt.check();
      const ms = Date.now() - started;
      if (!info) return { ok: true, message: 'Key works (the test book had no bestseller history).', ms };
      return { ok: true, message: `Works — “Where the Crawdads Sing” was on the ${info.lists[0].name} list for ${info.weeks} weeks.`, ms };
    }
    const book = await SOURCES.find((s) => s.id === id).module.lookupIsbn(TEST_ISBN);
    const ms = Date.now() - started;
    if (!book?.title) return { ok: false, message: `Connected, but the test book (ISBN ${TEST_ISBN}) wasn't found.`, ms };
    const by = book.authors?.length ? ` by ${book.authors.join(', ')}` : '';
    return { ok: true, message: `Works — found “${book.title}”${by}.`, ms };
  } catch (err) {
    return { ok: false, message: err.message, ms: Date.now() - started };
  }
}

const settle = async (promise, label) => {
  try {
    return await promise;
  } catch (err) {
    if (err.limitReached) console.log(`metadata: skipped ${label} — ${err.message}`);
    else console.warn(`metadata: ${label} failed — ${err.message}`);
    return null;
  }
};

const fullDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const firstWith = (list, pick) => list.map(pick).find((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length));

// Results arrive in the chosen order; for each field the first source that has it wins.
export function mergeResults(results) {
  const list = results.filter(Boolean);
  if (!list.length) return null;
  let title = firstWith(list, (r) => r.title) || null;
  // Open Library titles are often lower-case catalogue style ("Lanie's real
  // adventures"); if another source has the same title, use its capitalisation.
  const better = title && list.find((r) => r.source !== 'openlibrary' && r.title?.toLowerCase() === title.toLowerCase());
  if (better) title = better.title;
  const dates = list.map((r) => r.publish_date).filter(Boolean);
  return {
    title,
    subtitle: firstWith(list, (r) => r.subtitle),
    authors: firstWith(list, (r) => r.authors) || [],
    publisher: firstWith(list, (r) => r.publisher),
    publish_date: dates.find(fullDate) || dates[0] || null,
    description: firstWith(list, (r) => r.description),
    pages: firstWith(list, (r) => r.pages),
    isbn13: firstWith(list, (r) => r.isbn13),
    isbn10: firstWith(list, (r) => r.isbn10),
    cover_url: firstWith(list, (r) => r.cover_url),
    series: firstWith(list, (r) => r.series),
    volume: firstWith(list, (r) => r.volume),
    sources: [...new Set(list.map((r) => r.source))],
  };
}

// Good enough to stop asking more sources.
export const isComplete = (m) => !!(m?.title && m.authors?.length && m.cover_url && m.description);

export async function lookupIsbn(raw, { withNyt = true } = {}) {
  const ids = normalizeIsbn(raw);
  if (!ids) return null;
  const results = [];
  let merged = null;
  for (const source of activeSources()) {
    let r = await settle(source.module.lookupIsbn(ids.isbn13), source.id);
    // Some old books are only indexed by their ISBN-10 on Open Library.
    if (!r && source.id === 'openlibrary' && ids.isbn10) r = await settle(openlibrary.lookupIsbn(ids.isbn10), 'openlibrary');
    if (!r) continue;
    results.push(r);
    merged = mergeResults(results);
    if (isComplete(merged)) break;
  }
  if (!merged) return null;
  // The scanned ISBN always wins over whatever a source listed first.
  const book = { ...merged, isbn13: ids.isbn13, isbn10: ids.isbn10 || merged.isbn10 };
  if (withNyt && nytOn()) {
    const info = await settle(nyt.bestseller(ids.isbn13), 'nyt');
    if (info) {
      book.nyt = { weeks: info.weeks, best_rank: info.best_rank, lists: info.lists, review_url: info.review_url };
      book.description = book.description || info.description;
    }
  }
  return book;
}

// Free-text search: sources in order until there are enough results.
export async function search(query, limit = 15) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (normalizeIsbn(q)) {
    const hit = await lookupIsbn(q);
    return hit ? [hit] : [];
  }
  const out = [];
  const seen = new Set();
  for (const source of activeSources()) {
    const list = (await settle(source.module.search(q, 10), source.id)) || [];
    for (const r of list) {
      if (!r?.title) continue;
      const key = r.isbn13 || `${r.title.toLowerCase()}|${(r.authors[0] || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...r, sources: [r.source] });
    }
    if (out.length >= 8) break;
  }
  return out.slice(0, limit);
}

// ── Cover scans ──────────────────────────────────────────────────────────────
const NOISE = /(best ?sell|award|winner|edition|stepping stone|a novel|book \d+ in|illustrated|copyright|ages? \d|grades?|reading level|level \d|\$\d|isbn)/i;

const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);

// Score how well a candidate matches the text read off the cover.
export function scoreCandidate(candidate, coverText) {
  const cover = new Set(words(coverText));
  if (!cover.size) return 0;
  const titleWords = words(`${candidate.title} ${candidate.subtitle || ''}`);
  const authorWords = words((candidate.authors || []).join(' '));
  const hit = (list) => (list.length ? list.filter((w) => cover.has(w)).length / list.length : 0);
  return hit(titleWords) * 0.75 + hit(authorWords) * 0.25;
}

// Build a few search queries from OCR lines, biggest text first.
export function queriesFromLines(lines) {
  const clean = (lines || [])
    .map((l) => String(l).replace(/\s+/g, ' ').trim())
    .filter((l) => /\p{L}{2}/u.test(l) && !NOISE.test(l) && l.length <= 80);
  const byLine = clean.filter((l) => !/^by\s/i.test(l));
  const author = clean.find((l) => /^by\s/i.test(l))?.replace(/^by\s+/i, '');
  const queries = [];
  if (byLine.length) {
    queries.push([...byLine.slice(0, 2), author].filter(Boolean).join(' '));
    queries.push(byLine.slice(0, 3).join(' '));
    queries.push(byLine[0]);
  }
  return [...new Set(queries.filter((q) => q && q.length >= 3))];
}

// lines: OCR text lines (largest first). photo: optional { buffer, mediaType }.
export async function identifyCover({ lines = [], photo = null }) {
  const coverText = lines.join(' ');
  let aiGuess = null;
  const queries = [];

  if (photo && ai.enabled()) {
    aiGuess = await settle(ai.identifyCover(photo.buffer, photo.mediaType, lines.join('\n')), 'claude');
    if (aiGuess?.isbn && normalizeIsbn(aiGuess.isbn)) {
      const hit = await lookupIsbn(aiGuess.isbn);
      if (hit) return { results: [{ ...hit, score: 1 }], ai: aiGuess, query: aiGuess.isbn };
    }
    if (aiGuess) {
      if (aiGuess.search_query) queries.push(aiGuess.search_query);
      queries.push([aiGuess.title, aiGuess.authors?.[0]].filter(Boolean).join(' '));
    }
  }
  queries.push(...queriesFromLines(lines));

  const textForScoring = [coverText, aiGuess?.title, aiGuess?.subtitle, ...(aiGuess?.authors || []), aiGuess?.series]
    .filter(Boolean)
    .join(' ');

  const tried = [];
  let best = [];
  for (const q of [...new Set(queries)].slice(0, 4)) {
    tried.push(q);
    const results = (await search(q, 12)).map((r) => ({ ...r, score: scoreCandidate(r, textForScoring) }));
    results.sort((a, b) => b.score - a.score);
    if (results.length && (!best.length || results[0].score > best[0].score)) best = results;
    if (best[0]?.score >= 0.7) break;
  }
  return { results: best.slice(0, 10), ai: aiGuess, query: tried[0] || '' };
}
