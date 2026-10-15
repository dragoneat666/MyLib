// isbndb.js — ISBNdb (paid, very complete retail data — the same kind of data
// Libib's records look like). Only used when ISBNDB_API_KEY is set.
// https://isbndb.com/apidocs/v2

import { fetchJson } from './http.js';
import { config } from '../config.js';

const BASE = 'https://api2.isbndb.com';

export const enabled = () => !!config.isbndbKey;

function toResult(b) {
  return {
    source: 'isbndb',
    title: b.title || b.title_long || null,
    subtitle: null,
    authors: b.authors || [],
    publisher: b.publisher || null,
    publish_date: b.date_published || null,
    description: b.synopsis || b.overview || null,
    pages: b.pages || null,
    isbn13: b.isbn13 || null,
    isbn10: b.isbn10 || b.isbn || null,
    cover_url: b.image || null,
    series: null,
    link: null,
  };
}

const headers = () => ({ Authorization: config.isbndbKey });

export async function lookupIsbn(isbn) {
  if (!enabled()) return null;
  const data = await fetchJson(`${BASE}/book/${isbn}`, { headers: headers() });
  return data?.book ? toResult(data.book) : null;
}

export async function search(q, limit = 10) {
  if (!enabled()) return [];
  const data = await fetchJson(`${BASE}/books/${encodeURIComponent(q)}?page=1&pageSize=${limit}`, { headers: headers() });
  return (data?.books || []).map(toResult);
}
