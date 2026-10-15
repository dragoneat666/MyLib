// metadata/index.js — combines every configured book data source.
//
//   Open Library  — always on, free, no key
//   Google Books  — when GOOGLE_BOOKS_API_KEY is set (free key)
//   ISBNdb        — when ISBNDB_API_KEY is set (paid)
//   Claude        — when ANTHROPIC_API_KEY is set, used to read cover photos

import * as openlibrary from './openlibrary.js';
import * as google from './googlebooks.js';
import * as isbndb from './isbndb.js';
import * as ai from './ai.js';
import { normalizeIsbn } from './isbn.js';

export function providers() {
  return {
    openlibrary: true,
    google: google.enabled(),
    isbndb: isbndb.enabled(),
    ai: ai.enabled(),
  };
}

const settle = async (promise, label) => {
  try {
    return await promise;
  } catch (err) {
    console.warn(`metadata: ${label} failed — ${err.message}`);
    return null;
  }
};

const fullDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const firstWith = (list, pick) => list.map(pick).find((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length));

// Open Library titles are often lower-case library-catalogue style
// ("Lanie's real adventures"); prefer a retail source's capitalisation.
function niceTitle(results) {
  const preferred = results.find((r) => r.source !== 'openlibrary' && r.title);
  return preferred?.title || results.find((r) => r.title)?.title || null;
}

export function mergeResults(results) {
  const list = results.filter(Boolean);
  if (!list.length) return null;
  // Retail sources have better descriptions/publishers; Open Library has better covers and series.
  const byRetail = [...list].sort((a, b) => rank(a.source) - rank(b.source));
  const byCover = [...list].sort((a, b) => coverRank(a.source) - coverRank(b.source));
  const dates = list.map((r) => r.publish_date).filter(Boolean);
  return {
    title: niceTitle(byRetail),
    subtitle: firstWith(byRetail, (r) => r.subtitle),
    authors: firstWith(byRetail, (r) => r.authors) || [],
    publisher: firstWith(byRetail, (r) => r.publisher),
    publish_date: dates.find(fullDate) || dates[0] || null,
    description: firstWith(byRetail, (r) => r.description),
    pages: firstWith(byRetail, (r) => r.pages),
    isbn13: firstWith(list, (r) => r.isbn13),
    isbn10: firstWith(list, (r) => r.isbn10),
    cover_url: firstWith(byCover, (r) => r.cover_url),
    series: firstWith(list, (r) => r.series),
    sources: [...new Set(list.map((r) => r.source))],
  };
}
const rank = (s) => ({ google: 0, isbndb: 1, openlibrary: 2 })[s] ?? 3;
const coverRank = (s) => ({ openlibrary: 0, google: 1, isbndb: 2 })[s] ?? 3;

export async function lookupIsbn(raw) {
  const ids = normalizeIsbn(raw);
  if (!ids) return null;
  const isbn = ids.isbn13;
  const results = await Promise.all([
    settle(openlibrary.lookupIsbn(isbn), 'openlibrary'),
    settle(google.lookupIsbn(isbn), 'google'),
    settle(isbndb.lookupIsbn(isbn), 'isbndb'),
  ]);
  // Some old books are only indexed by their ISBN-10.
  if (!results.some(Boolean) && ids.isbn10) {
    results.push(await settle(openlibrary.lookupIsbn(ids.isbn10), 'openlibrary-10'));
  }
  const merged = mergeResults(results);
  if (!merged) return null;
  // The scanned ISBN always wins over whatever a source listed first.
  return { ...merged, isbn13: ids.isbn13, isbn10: ids.isbn10 || merged.isbn10 };
}

// Free-text search across sources, de-duplicated by ISBN.
export async function search(query, limit = 15) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (normalizeIsbn(q)) {
    const hit = await lookupIsbn(q);
    return hit ? [hit] : [];
  }
  const lists = await Promise.all([
    settle(google.search(q, 10), 'google'),
    settle(isbndb.search(q, 10), 'isbndb'),
    settle(openlibrary.search(q, 10), 'openlibrary'),
  ]);
  const out = [];
  const seen = new Set();
  // Interleave so each source's best match is near the top.
  const max = Math.max(...lists.map((l) => l?.length || 0));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      const r = list?.[i];
      if (!r || !r.title) continue;
      const key = r.isbn13 || `${r.title.toLowerCase()}|${(r.authors[0] || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...r, sources: [r.source] });
    }
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
