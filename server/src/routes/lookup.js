// routes/lookup.js — /api/lookup : find book information online.

import { Router } from 'express';
import multer from 'multer';
import { lookupIsbn, search, identifyCover, providerDetails, testProvider } from '../metadata/index.js';
import { normalizeIsbn } from '../metadata/isbn.js';
import { findOwned } from '../items.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

const withOwned = (r) => ({ ...r, owned: r.isbn13 || r.isbn10 ? findOwned(r.isbn13 || r.isbn10) : [] });

router.get('/providers', (_req, res) => res.json({ providers: providerDetails() }));

// POST /api/lookup/providers/:id/test — "Test" button in Settings
router.post('/providers/:id/test', async (req, res) => {
  res.json(await testProvider(req.params.id));
});

// GET /api/lookup/isbn/:isbn — one barcode scan
router.get('/isbn/:isbn', async (req, res) => {
  const ids = normalizeIsbn(req.params.isbn);
  if (!ids) return res.status(400).json({ error: "That isn't a valid ISBN" });
  const result = await lookupIsbn(ids.isbn13);
  const owned = findOwned(ids.isbn13);
  if (!result) {
    // Still tell the phone whether we own it, and give it the ISBN to add manually.
    return res.status(404).json({ error: 'No book found for this ISBN', isbn13: ids.isbn13, isbn10: ids.isbn10, owned });
  }
  res.json({ ...result, owned });
});

// GET /api/lookup/search?q=… — title / author / ISBN text search
router.get('/search', async (req, res) => {
  const results = await search(req.query.q || '', 20);
  res.json({ results: results.map(withOwned) });
});

// POST /api/lookup/cover — identify a book from a cover photo.
// multipart: photo (optional JPEG), lines (JSON array of OCR text lines, biggest text first)
router.post('/cover', upload.single('photo'), async (req, res) => {
  let lines = [];
  try {
    lines = JSON.parse(req.body?.lines || '[]');
  } catch {
    lines = String(req.body?.lines || '').split('\n');
  }
  lines = (Array.isArray(lines) ? lines : []).map(String).filter(Boolean).slice(0, 40);
  const photo = req.file?.mimetype?.startsWith('image/') ? { buffer: req.file.buffer, mediaType: req.file.mimetype } : null;
  if (!lines.length && !photo) return res.status(400).json({ error: 'Send a photo or the text read from the cover' });
  const out = await identifyCover({ lines, photo });
  res.json({ ...out, results: out.results.map(withOwned) });
});

export default router;
