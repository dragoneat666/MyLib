// routes/tags.js — /api/tags : the shared tag list (Settings → Tags, tag pickers, side menu).

import { Router } from 'express';
import { listTags, registerTags, renameTag, deleteTag } from '../tags.js';

const router = Router();

router.get('/', (_req, res) => res.json({ tags: listTags() }));

router.post('/', (req, res) => {
  const [name] = registerTags([req.body?.name]);
  if (!name) return res.status(400).json({ error: 'Tag name is required' });
  res.json({ tags: listTags(), name });
});

// Renaming onto an existing tag's name merges the two.
router.put('/:id', (req, res) => {
  renameTag(Number(req.params.id), req.body?.name);
  res.json({ tags: listTags() });
});

// Removes the tag from every book too.
router.delete('/:id', (req, res) => {
  deleteTag(Number(req.params.id));
  res.json({ tags: listTags() });
});

export default router;
