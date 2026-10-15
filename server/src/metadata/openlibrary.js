// openlibrary.js — Open Library (Internet Archive). Free, no API key.
// https://openlibrary.org/developers/api

import { fetchJson } from './http.js';
import { normalizeIsbn } from './isbn.js';

const BASE = 'https://openlibrary.org';
const coverUrl = (id) => (id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : null);

const text = (v) => (v && typeof v === 'object' ? v.value : v) || null;

function firstIsbns(list = []) {
  for (const raw of list) {
    const n = normalizeIsbn(raw);
    if (n) return n;
  }
  return { isbn13: null, isbn10: null };
}

export async function lookupIsbn(isbn) {
  const key = `ISBN:${isbn}`;
  const data = await fetchJson(`${BASE}/api/books?bibkeys=${key}&format=json&jscmd=details`);
  const d = data?.[key]?.details;
  if (!d) return null;

  let description = text(d.description);
  let authors = (d.authors || []).map((a) => a.name).filter(Boolean);

  // Editions often lack a description/authors; the parent "work" usually has them.
  const workKey = d.works?.[0]?.key;
  if (workKey && (!description || !authors.length)) {
    try {
      const work = await fetchJson(`${BASE}${workKey}.json`);
      description = description || text(work?.description);
      if (!authors.length && work?.authors?.length) {
        const names = await Promise.all(
          work.authors.slice(0, 3).map((a) =>
            fetchJson(`${BASE}${a.author?.key}.json`).then((x) => x?.name).catch(() => null)
          )
        );
        authors = names.filter(Boolean);
      }
    } catch {
      // description is optional
    }
  }

  const ids = normalizeIsbn(isbn) || {};
  return {
    source: 'openlibrary',
    title: d.title || null,
    subtitle: d.subtitle || null,
    authors,
    publisher: d.publishers?.[0] || null,
    publish_date: d.publish_date || null,
    description,
    pages: d.number_of_pages || null,
    isbn13: ids.isbn13 || d.isbn_13?.[0] || null,
    isbn10: ids.isbn10 || d.isbn_10?.[0] || null,
    cover_url: coverUrl(d.covers?.find((c) => c > 0)),
    series: d.series?.[0] || null,
    link: `${BASE}${d.key}`,
  };
}

export async function search(query, limit = 10) {
  const fields = [
    'key', 'title', 'subtitle', 'author_name', 'cover_i', 'first_publish_year', 'number_of_pages_median',
    'editions', 'editions.key', 'editions.title', 'editions.isbn', 'editions.publisher',
    'editions.publish_date', 'editions.cover_i',
  ].join(',');
  const url = `${BASE}/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
  const data = await fetchJson(url, { timeout: 15000 });
  return (data?.docs || []).map((doc) => {
    const ed = doc.editions?.docs?.[0] || {};
    const ids = firstIsbns(ed.isbn);
    return {
      source: 'openlibrary',
      title: doc.title || ed.title,
      subtitle: doc.subtitle || null,
      authors: doc.author_name || [],
      publisher: ed.publisher?.[0] || null,
      publish_date: ed.publish_date?.[0] || (doc.first_publish_year ? String(doc.first_publish_year) : null),
      description: null,
      pages: doc.number_of_pages_median || null,
      isbn13: ids.isbn13,
      isbn10: ids.isbn10,
      cover_url: coverUrl(ed.cover_i) || coverUrl(doc.cover_i),
      series: null,
      link: `${BASE}${ed.key || doc.key}`,
    };
  });
}

// Cover by ISBN; "default=false" makes Open Library 404 instead of returning a blank image.
export const coverByIsbn = (isbn) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
