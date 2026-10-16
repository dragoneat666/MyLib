// nyt.js — New York Times Books API (NYT_API_KEY). It only knows about NYT
// best seller lists and NYT reviews, so it isn't used for general book details;
// MyLib uses it to mark a looked-up book as a "NYT Bestseller".
// Capped at NYT_DAILY_LIMIT (default 1,000) calls a day and 5 a minute (usage.js).
// Spec: https://github.com/nytimes/public_api_specs/tree/master/books_api

import { fetchJson } from './http.js';
import { config } from '../config.js';

const BASE = 'https://api.nytimes.com/svc/books/v3';

export const enabled = () => !!config.nytKey;

// { lists: [{ name, best_rank, weeks }], weeks, best_rank, review_url } or null if never a bestseller.
export async function bestseller(isbn) {
  if (!enabled() || !isbn) return null;
  const url = `${BASE}/lists/best-sellers/history.json?isbn=${encodeURIComponent(isbn)}&api-key=${encodeURIComponent(config.nytKey)}`;
  const data = await fetchJson(url, { source: 'nyt' });
  const book = data?.results?.[0];
  const ranks = book?.ranks_history || [];
  if (!book || !ranks.length) return null;
  const byList = new Map();
  for (const r of ranks) {
    const name = r.display_name || r.list_name;
    const entry = byList.get(name) || { name, best_rank: r.rank, weeks: 0 };
    entry.best_rank = Math.min(entry.best_rank, r.rank);
    entry.weeks = Math.max(entry.weeks, r.weeks_on_list || 0);
    byList.set(name, entry);
  }
  const lists = [...byList.values()];
  return {
    lists,
    weeks: Math.max(...lists.map((l) => l.weeks)),
    best_rank: Math.min(...lists.map((l) => l.best_rank)),
    review_url: book.reviews?.find((r) => r.book_review_link)?.book_review_link || null,
    description: book.description || null,
  };
}

// Settings → Test: a known bestseller (Where the Crawdads Sing).
export async function check() {
  return bestseller('9780735219090');
}
