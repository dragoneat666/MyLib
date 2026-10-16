// Unit tests: ISBN helpers, Libib CSV import/export and SQL dump round-trip.
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mylib-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.BACKUP_DIR = path.join(tmp, 'backups');

const { normalizeIsbn, isbn10to13, isbn13to10 } = await import('../src/metadata/isbn.js');
const { parseLibibCsv, rowToItem, itemsToCsv, LIBIB_COLUMNS } = await import('../src/libib.js');
const { initDb, getDb, migrate, MIGRATIONS } = await import('../src/db.js');
const { parseTags, changeItemTags, listTags, renameTag, deleteTag } = await import('../src/tags.js');
const { sqlDump } = await import('../src/backup.js');
const { scoreCandidate, queriesFromLines, mergeResults } = await import('../src/metadata/index.js');

const SAMPLE = `id,item_type,title,creators,first_name,last_name,collection,ean_isbn13,upc_isbn10,description,publisher,publish_date,group,tags,notes,price,length,number_of_discs,number_of_players,age_group,ensemble,aspect_ratio,esrb,rating,review,review_date,status,began,completed,added,copies
abc123def0,book,"Riddle of the Prairie Bride","Kathryn Reiss",Kathryn,Reiss,"American girl",9780439398749,0439398746,"A ""mail-order"" bride
arrives in Kansas.",Scholastic,2002-01-01,,"mystery, history",,,,,,,,,,,,,,,,2026-10-15,1
xyz789uvw1,book,"No ISBN Book",,,,"Magic Tree House",,,,,,,,,,,,,,,,,,,,,,,2026-10-14,2
`;

test('ISBN normalisation and conversion', () => {
  assert.deepEqual(normalizeIsbn('0-439-39874-6'), { isbn13: '9780439398749', isbn10: '0439398746' });
  assert.deepEqual(normalizeIsbn('978-1-60958-371-2'), { isbn13: '9781609583712', isbn10: '160958371X' });
  assert.equal(normalizeIsbn('9781609583713'), null);
  assert.equal(normalizeIsbn('hello'), null);
  assert.equal(isbn10to13('160958371X'), '9781609583712');
  assert.equal(isbn13to10('9790000000001'), null);
});

test('Libib CSV parsing keeps text ISBNs, multi-line text and quotes', () => {
  const rows = parseLibibCsv(Buffer.from(SAMPLE));
  assert.equal(rows.length, 2);
  const a = rowToItem(rows[0]);
  assert.equal(a.collection, 'American girl');
  assert.equal(a.sourceId, 'abc123def0');
  assert.equal(a.fields.upc_isbn10, '0439398746');
  assert.equal(a.fields.description, 'A "mail-order" bride\narrives in Kansas.');
  assert.equal(a.fields.tags, 'mystery, history');
  const b = rowToItem(rows[1]);
  assert.equal(b.fields.copies, 2);
  assert.equal(b.fields.ean_isbn13, null);
});

test('rejects files that are not Libib exports', () => {
  assert.throws(() => parseLibibCsv(Buffer.from('foo,bar\n1,2\n')), /Libib/);
});

test('CSV export uses Libib column order and re-parses identically', () => {
  const rows = parseLibibCsv(Buffer.from(SAMPLE));
  const items = rows.map((r, i) => {
    const { fields, sourceId, collection } = rowToItem(r);
    return { id: i + 1, source_id: sourceId, collection_name: collection, ...fields };
  });
  const csv = itemsToCsv(items);
  assert.ok(csv.startsWith(LIBIB_COLUMNS.join(',') + ',series,volume,cover_url'));
  const again = parseLibibCsv(Buffer.from(csv)).map(rowToItem);
  assert.deepEqual(again[0].fields.description, items[0].description);
  assert.equal(again[0].fields.upc_isbn10, '0439398746');
});

test('SQL dump restores into an identical database', () => {
  initDb();
  const db = getDb();
  db.prepare("INSERT INTO collections (name) VALUES ('Test ''quoted'' shelf')").run();
  db.prepare("INSERT INTO items (collection_id, title, description, ean_isbn13) VALUES (1, 'It''s a book', 'line1\nline2', '9780439398749')").run();

  const dump = sqlDump(db);
  assert.ok(!/CREATE TABLE (users|tokens)/.test(dump), 'login tables are gone');
  const blank = new Database(path.join(tmp, 'restored.db'));
  blank.exec(dump);
  assert.equal(blank.prepare('SELECT name FROM collections').get().name, "Test 'quoted' shelf");
  const item = blank.prepare('SELECT * FROM items').get();
  assert.equal(item.title, "It's a book");
  assert.equal(item.description, 'line1\nline2');
  assert.equal(blank.pragma('user_version', { simple: true }), db.pragma('user_version', { simple: true }));
  blank.close();
});

test('cover text matching prefers the right book', () => {
  const cover = 'MAGIC TREE HOUSE Mummies in the Morning #3 MARY POPE OSBORNE';
  const right = { title: 'Mummies in the Morning', authors: ['Mary Pope Osborne'] };
  const wrong = { title: 'Dinosaurs Before Dark', authors: ['Mary Pope Osborne'] };
  assert.ok(scoreCandidate(right, cover) > scoreCandidate(wrong, cover));
  const queries = queriesFromLines(['Mummies in the Morning', 'MAGIC TREE HOUSE', 'by Mary Pope Osborne', 'A Stepping Stone Book']);
  assert.equal(queries[0], 'Mummies in the Morning MAGIC TREE HOUSE Mary Pope Osborne');
});

test('merging sources prefers retail titles and full dates', () => {
  const merged = mergeResults([
    { source: 'openlibrary', title: "Lanie's real adventures", authors: ['Jane Kurtz'], publish_date: '2010', cover_url: 'ol.jpg', series: 'American girl' },
    { source: 'google', title: "Lanie's Real Adventures", authors: ['Jane Kurtz'], publish_date: '2010-01-01', description: 'desc', cover_url: 'g.jpg' },
  ]);
  assert.equal(merged.title, "Lanie's Real Adventures");
  assert.equal(merged.publish_date, '2010-01-01');
  assert.equal(merged.cover_url, 'ol.jpg');
  assert.equal(merged.series, 'American girl');
  assert.deepEqual(merged.sources, ['openlibrary', 'google']);
});

test('a v1 database (with logins) upgrades: logins gone, unsorted allowed, tags listed', () => {
  const old = new Database(':memory:');
  old.pragma('foreign_keys = ON');
  old.exec(MIGRATIONS[0]);
  old.pragma('user_version = 1');
  old.exec(`INSERT INTO users (username, password_hash) VALUES ('admin', 'x');
            INSERT INTO collections (name) VALUES ('American girl');
            INSERT INTO items (collection_id, title, tags) VALUES (1, 'Meet Rebecca', 'christmas, Signed');`);
  migrate(old);
  const tables = old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  assert.ok(!tables.includes('users') && !tables.includes('tokens'));
  assert.equal(old.prepare('SELECT title FROM items').get().title, 'Meet Rebecca');
  // New & Unsorted: a book without a collection
  old.prepare("INSERT INTO items (collection_id, title) VALUES (NULL, 'Loose book')").run();
  // Deleting a collection no longer deletes books by itself
  old.prepare('DELETE FROM collections WHERE id = 1').run();
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM items WHERE collection_id IS NULL').get().n, 2);
  assert.deepEqual(old.prepare('SELECT name FROM tags ORDER BY name').all().map((t) => t.name), ['christmas', 'Signed']);
});

test('tags: parse, match existing spelling, rename/merge, delete', () => {
  const db = getDb();
  db.prepare("INSERT INTO collections (name) VALUES ('Tag test')").run();
  const cid = db.prepare("SELECT id FROM collections WHERE name = 'Tag test'").get().id;
  const a = db.prepare("INSERT INTO items (collection_id, title) VALUES (?, 'A')").run(cid).lastInsertRowid;
  const b = db.prepare("INSERT INTO items (collection_id, title) VALUES (?, 'B')").run(cid).lastInsertRowid;
  assert.deepEqual(parseTags(' Christmas , christmas,Signed,, '), ['Christmas', 'Signed']);
  changeItemTags([a, b], { add: ['Christmas', 'Garage sale'] });
  changeItemTags([b], { add: ['christmas'] }); // same tag, different case
  assert.equal(db.prepare('SELECT tags FROM items WHERE id = ?').get(b).tags, 'Christmas, Garage sale');
  const list = listTags();
  assert.equal(list.find((t) => t.name === 'Christmas').count, 2);
  // rename onto an existing name merges
  renameTag(list.find((t) => t.name === 'Garage sale').id, 'christmas');
  assert.equal(db.prepare('SELECT tags FROM items WHERE id = ?').get(a).tags, 'Christmas');
  assert.ok(!listTags().some((t) => t.name === 'Garage sale'));
  deleteTag(listTags().find((t) => t.name === 'Christmas').id);
  assert.equal(db.prepare('SELECT tags FROM items WHERE id = ?').get(a).tags, null);
});
