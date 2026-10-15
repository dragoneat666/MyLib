// googlebooks.js — Google Books API. Needs a free API key (GOOGLE_BOOKS_API_KEY);
// Google no longer gives anonymous requests any quota.
// https://developers.google.com/books/docs/v1/using

import { fetchJson } from './http.js';
import { config } from '../config.js';

const BASE = 'https://www.googleapis.com/books/v1/volumes';

export const enabled = () => !!config.googleBooksKey;

function cover(imageLinks) {
  const url = imageLinks?.thumbnail || imageLinks?.smallThumbnail;
  if (!url) return null;
  return url.replace(/^http:/, 'https:').replace('&edge=curl', '');
}

function toResult(item) {
  const v = item.volumeInfo || {};
  const ids = Object.fromEntries((v.industryIdentifiers || []).map((i) => [i.type, i.identifier]));
  return {
    source: 'google',
    title: v.title || null,
    subtitle: v.subtitle || null,
    authors: v.authors || [],
    publisher: v.publisher || null,
    publish_date: v.publishedDate || null,
    description: v.description || null,
    pages: v.pageCount || null,
    isbn13: ids.ISBN_13 || null,
    isbn10: ids.ISBN_10 || null,
    cover_url: cover(v.imageLinks),
    series: null,
    link: v.infoLink || null,
  };
}

async function query(q, max) {
  const url = `${BASE}?q=${encodeURIComponent(q)}&maxResults=${max}&printType=books&key=${encodeURIComponent(config.googleBooksKey)}`;
  const data = await fetchJson(url);
  return (data?.items || []).map(toResult);
}

export async function lookupIsbn(isbn) {
  if (!enabled()) return null;
  const results = await query(`isbn:${isbn}`, 1);
  return results[0] || null;
}

export async function search(q, limit = 10) {
  if (!enabled()) return [];
  return query(q, limit);
}
