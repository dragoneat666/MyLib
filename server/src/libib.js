// libib.js — Libib CSV format (import + export).
//
// Exports use Libib's exact column order so a file can go back into Libib,
// with MyLib's extra columns (series, volume, cover_url) appended at the end.

import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { normalizeIsbn, cleanIsbn } from './metadata/isbn.js';

export const LIBIB_COLUMNS = [
  'id', 'item_type', 'title', 'creators', 'first_name', 'last_name', 'collection', 'ean_isbn13', 'upc_isbn10',
  'description', 'publisher', 'publish_date', 'group', 'tags', 'notes', 'price', 'length', 'number_of_discs',
  'number_of_players', 'age_group', 'ensemble', 'aspect_ratio', 'esrb', 'rating', 'review', 'review_date',
  'status', 'began', 'completed', 'added', 'copies',
];
export const EXTRA_COLUMNS = ['series', 'volume', 'cover_url'];

// Item columns a client may set directly (everything except ids/timestamps/cover file).
export const ITEM_FIELDS = [
  'item_type', 'title', 'creators', 'first_name', 'last_name', 'ean_isbn13', 'upc_isbn10', 'description',
  'publisher', 'publish_date', 'item_group', 'tags', 'notes', 'price', 'length', 'number_of_discs',
  'number_of_players', 'age_group', 'ensemble', 'aspect_ratio', 'esrb', 'rating', 'review', 'review_date',
  'status', 'began', 'completed', 'added', 'copies', 'series', 'volume', 'cover_url',
];

const CSV_TO_DB = { group: 'item_group' };

export function parseLibibCsv(buffer) {
  const records = parse(buffer, {
    columns: (header) => header.map((h) => String(h).trim().toLowerCase().replace(/\s+/g, '_')),
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: false,
  });
  if (records.length && !('title' in records[0])) {
    throw new Error('This doesn\'t look like a Libib export — there is no "title" column.');
  }
  return records;
}

const blank = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

// Turns one CSV row into { collection, sourceId, fields } ready for the database.
export function rowToItem(row) {
  const fields = {};
  for (const col of [...LIBIB_COLUMNS, ...EXTRA_COLUMNS]) {
    if (col === 'id' || col === 'collection') continue;
    const dbCol = CSV_TO_DB[col] || col;
    if (ITEM_FIELDS.includes(dbCol)) fields[dbCol] = blank(row[col]);
  }
  fields.item_type = fields.item_type || 'book';
  fields.copies = Math.max(1, parseInt(fields.copies, 10) || 1);
  // Keep ISBNs as text (leading zeros!) and fill in the missing form when possible.
  const ids = normalizeIsbn(fields.ean_isbn13) || normalizeIsbn(fields.upc_isbn10);
  if (ids) {
    fields.ean_isbn13 = fields.ean_isbn13 ? cleanIsbn(fields.ean_isbn13) : ids.isbn13;
    fields.upc_isbn10 = fields.upc_isbn10 ? cleanIsbn(fields.upc_isbn10) : ids.isbn10;
  }
  if (!fields.creators && (fields.first_name || fields.last_name)) {
    fields.creators = [fields.first_name, fields.last_name].filter(Boolean).join(' ');
  }
  return {
    collection: blank(row.collection),
    sourceId: blank(row.id),
    fields,
  };
}

// items: rows from the database joined with collection_name.
export function itemsToCsv(items) {
  const rows = items.map((it) => {
    const out = {};
    for (const col of [...LIBIB_COLUMNS, ...EXTRA_COLUMNS]) {
      if (col === 'id') out.id = it.source_id || `mylib-${it.id}`;
      else if (col === 'collection') out.collection = it.collection_name;
      else out[col] = it[CSV_TO_DB[col] || col] ?? '';
    }
    return out;
  });
  return stringify(rows, {
    header: true,
    columns: [...LIBIB_COLUMNS, ...EXTRA_COLUMNS],
    quoted_match: /[\s,"]/, // quote text the way Libib does; keeps ISBNs etc. plain
  });
}

// Split "Mary Pope Osborne" into first/last for Libib's first_name/last_name columns.
export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: null, last_name: parts[0] };
  return { first_name: parts[0], last_name: parts[parts.length - 1] };
}
