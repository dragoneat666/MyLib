// hardcover.js — Hardcover (hardcover.app), GraphQL API. Needs a personal API
// token (HARDCOVER_API_TOKEN) from hardcover.app → Settings → Hardcover API.
// Free plan: 5,000 requests/day, 60/minute; each top-level field counts as one
// request, so every query below uses a single top-level field.
// https://docs.hardcover.app/api/getting-started/

import { fetchJson } from './http.js';
import { normalizeIsbn } from './isbn.js';
import { config } from '../config.js';

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';

export const enabled = () => !!config.hardcoverToken;

// Tokens are copied from Hardcover either as "Bearer abc…" or just "abc…".
const authHeader = () => (/^bearer\s/i.test(config.hardcoverToken) ? config.hardcoverToken : `Bearer ${config.hardcoverToken}`);

async function graphql(query, variables) {
  const data = await fetchJson(ENDPOINT, {
    method: 'POST',
    source: 'hardcover',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (data?.errors?.length) {
    const msg = data.errors.map((e) => (typeof e === 'string' ? e : e.message)).join('; ');
    throw new Error(`Hardcover: ${msg}`);
  }
  return data?.data;
}

const EDITION_BY_ISBN = `
query EditionByIsbn($isbn13: String, $isbn10: String) {
  editions(where: {_or: [{isbn_13: {_eq: $isbn13}}, {isbn_10: {_eq: $isbn10}}]}, limit: 1) {
    title
    subtitle
    isbn_13
    isbn_10
    pages
    release_date
    image { url }
    publisher { name }
    contributions { author { name } }
    book {
      title
      subtitle
      description
      pages
      release_date
      slug
      image { url }
      contributions { author { name } }
      featured_book_series { position series { name } }
    }
  }
}`;

const names = (contributions) => [...new Set((contributions || []).map((c) => c.author?.name).filter(Boolean))];

export async function lookupIsbn(isbn) {
  if (!enabled()) return null;
  const ids = normalizeIsbn(isbn) || {};
  const data = await graphql(EDITION_BY_ISBN, { isbn13: ids.isbn13 || isbn, isbn10: ids.isbn10 || '-' });
  const e = data?.editions?.[0];
  if (!e) return null;
  const b = e.book || {};
  const series = b.featured_book_series;
  return {
    source: 'hardcover',
    title: e.title || b.title || null,
    subtitle: e.subtitle || b.subtitle || null,
    authors: names(e.contributions).length ? names(e.contributions) : names(b.contributions),
    publisher: e.publisher?.name || null,
    publish_date: e.release_date || b.release_date || null,
    description: b.description || null,
    pages: e.pages || b.pages || null,
    isbn13: e.isbn_13 || ids.isbn13 || null,
    isbn10: e.isbn_10 || ids.isbn10 || null,
    cover_url: e.image?.url || b.image?.url || null,
    series: series?.series?.name || null,
    volume: series?.position != null ? String(series.position).replace(/\.0$/, '') : null,
    link: b.slug ? `https://hardcover.app/books/${b.slug}` : null,
  };
}

const SEARCH = `
query SearchBooks($q: String!, $perPage: Int!) {
  search(query: $q, query_type: "Book", per_page: $perPage, page: 1) { results }
}`;

export async function search(q, limit = 10) {
  if (!enabled()) return [];
  const data = await graphql(SEARCH, { q, perPage: limit });
  // `results` is the Typesense response: { hits: [{ document: {...} }] }
  let results = data?.search?.results;
  if (typeof results === 'string') results = JSON.parse(results);
  return (results?.hits || []).map(({ document: d = {} }) => {
    const isbn = (d.isbns || []).map(normalizeIsbn).find(Boolean) || {};
    return {
      source: 'hardcover',
      title: d.title || null,
      subtitle: d.subtitle || null,
      authors: d.author_names || [],
      publisher: null,
      publish_date: d.release_year ? String(d.release_year) : null,
      description: d.description || null,
      pages: d.pages || null,
      isbn13: isbn.isbn13 || null,
      isbn10: isbn.isbn10 || null,
      cover_url: d.image?.url || null,
      series: d.featured_series?.series?.name || d.series_names?.[0] || null,
      link: d.slug ? `https://hardcover.app/books/${d.slug}` : null,
    };
  }).filter((r) => r.title);
}

// Settings → Test: the token's own user, which proves the token works.
export async function checkToken() {
  const data = await graphql('query { me { username } }', {});
  const me = Array.isArray(data?.me) ? data.me[0] : data?.me;
  return me?.username || null;
}
