// AddBook.jsx — add books by ISBN / title search, or by typing them in.
// New books go to New & Unsorted unless another collection is picked.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, androidBridge, STATUSES } from '../api.js';
import { useApp } from '../context.jsx';
import { CollectionSelect, Cover, Icon, TagDialog, tagList } from '../components/ui.jsx';
import ItemDetail from '../components/ItemDetail.jsx';

export default function AddBook() {
  const { collections, toast, libraryChanged, refreshCollections } = useApp();
  const [params] = useSearchParams();
  const [target, setTarget] = useState({ id: Number(params.get('collection')) || 0 });
  const [query, setQuery] = useState(params.get('q') || '');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [done, setDone] = useState({}); // result key -> { itemId, note }
  const [editId, setEditId] = useState(null);
  const [tagging, setTagging] = useState(null); // { id, title, tags, replace? }
  const [manual, setManual] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setTarget({ id: Number(params.get('collection')) || 0 });
    // ?q=… (e.g. from the phone scanner) searches straight away.
    const q = params.get('q');
    if (q) {
      setQuery(q);
      search(null, q);
    }
  }, [params]);

  const targetName = target.newName?.trim() || collections.find((c) => c.id === target.id)?.name || 'New & Unsorted';
  const targetBody = () => (target.newName ? { collection_name: target.newName.trim() } : { collection_id: target.id || 0 });
  const ready = !('newName' in target) || !!target.newName.trim();

  const search = async (e, text = query) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q) return;
    setSearching(true);
    setResults(null);
    setDone({});
    try {
      const data = await api.get(`/api/lookup/search?q=${encodeURIComponent(q)}`);
      setResults(data.results);
    } catch (err) {
      toast(err.message, 'error');
      setResults([]);
    }
    setSearching(false);
  };

  const afterAdd = async (item) => {
    if (target.newName) {
      await refreshCollections();
      setTarget({ id: item.collection_id || 0 });
    }
    libraryChanged();
    toast(`Added “${item.title}” to ${item.collection_name}`, 'success', {
      action: { label: 'Add tag', onClick: () => setTagging({ id: item.id, title: item.title, tags: tagList(item.tags) }) },
    });
  };

  const add = async (r, key) => {
    try {
      const item = await api.post('/api/items', { ...targetBody(), metadata: r });
      setDone((d) => ({ ...d, [key]: { itemId: item.id, title: item.title, tags: item.tags, note: `Added to ${item.collection_name}` } }));
      await afterAdd(item);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // The three choices when the book is already in MyLib.
  const addCopy = async (owned, key) => {
    try {
      const item = await api.post(`/api/items/${owned.id}/copies`, { delta: 1 });
      setDone((d) => ({ ...d, [key]: { itemId: item.id, title: item.title, tags: item.tags, note: `Now ${item.copies} copies` } }));
      libraryChanged();
      toast(`${item.title}: now ${item.copies} copies`, 'success', {
        action: { label: 'Add tag', onClick: () => setTagging({ id: item.id, title: item.title, tags: tagList(item.tags) }) },
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const replaceCopy = (owned, key) =>
    setTagging({ id: owned.id, title: owned.title, tags: tagList(owned.tags), replace: true, key });
  const ignore = (key) => setDone((d) => ({ ...d, [key]: { note: 'Ignored' } }));

  const saveTags = async (list) => {
    try {
      const item = await api.post(`/api/items/${tagging.id}/tags`, { set: list });
      if (tagging.replace) {
        setDone((d) => ({ ...d, [tagging.key]: { itemId: item.id, title: item.title, tags: item.tags, note: 'Kept as a replacement copy' } }));
      }
      toast(list.length ? `Tagged “${item.title}”: ${list.join(', ')}` : `Tags cleared on “${item.title}”`, 'success');
      setTagging(null);
      libraryChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>Add books</h1>
          <p className="muted">Search by ISBN, title or author{androidBridge?.scan ? ', or scan with the camera' : ''}.</p>
        </div>
        {androidBridge?.scan && (
          <button className="btn btn-accent" onClick={() => androidBridge.scan(target.id || 0)}>
            <Icon name="camera" size={18} /> Scan with camera
          </button>
        )}
      </div>

      <div className="card stack">
        <label className="field">
          <span>Add to</span>
          <CollectionSelect value={target.id} onChange={setTarget} />
        </label>
        <form className="search-row" onSubmit={search}>
          <input ref={inputRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="ISBN (e.g. 9780679824114) or title and author" inputMode="search" />
          <button className="btn btn-primary" disabled={searching || !query.trim()}>
            <Icon name="search" size={18} /> {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        <button className="link-btn" onClick={() => setManual((m) => !m)}>
          {manual ? 'Hide manual entry' : "Can't find it? Enter it by hand"}
        </button>
        {manual && (
          <ManualForm initialIsbn={/^[\dXx-]{10,17}$/.test(query.trim()) ? query.trim() : ''} ready={ready}
            targetBody={targetBody} onAdded={afterAdd}
            onCopy={(owned) => addCopy(owned, 'manual')} onReplace={(owned) => replaceCopy(owned, 'manual')} />
        )}
      </div>

      {searching && <p className="muted center pad">Looking that up…</p>}
      {results && !results.length && <p className="muted center pad">Nothing found. Try fewer words, the ISBN, or enter it by hand.</p>}
      {results?.length > 0 && (
        <ul className="results">
          {results.map((r, i) => {
            const key = r.isbn13 || `${r.title}-${i}`;
            const state = done[key];
            const owned = r.owned || [];
            return (
              <li key={key} className="result">
                <Cover src={r.cover_url} title={r.title} size="sm" />
                <div className="result-info">
                  <strong>{r.title}{r.subtitle ? `: ${r.subtitle}` : ''}</strong>
                  {r.authors?.length > 0 && <span>{r.authors.join(', ')}</span>}
                  <span className="muted small">
                    {[r.publisher, r.publish_date, r.pages && `${r.pages} pages`, r.isbn13].filter(Boolean).join(' · ')}
                  </span>
                  {owned.length > 0 && !state && (
                    <DuplicateChoice owned={owned} onReplace={() => replaceCopy(owned[0], key)}
                      onCopy={() => addCopy(owned[0], key)} onIgnore={() => ignore(key)} />
                  )}
                  {state && <span className="done-note"><Icon name="check" size={16} /> {state.note}</span>}
                </div>
                <div className="result-actions">
                  {state?.itemId ? (
                    <>
                      <button className="btn btn-small" onClick={() => setTagging({ id: state.itemId, title: state.title, tags: tagList(state.tags) })}>
                        <Icon name="tag" size={16} /> Add tag
                      </button>
                      <button className="btn btn-small" onClick={() => setEditId(state.itemId)}><Icon name="edit" size={16} /> Edit</button>
                    </>
                  ) : !state && !owned.length ? (
                    <button className="btn btn-primary btn-small" onClick={() => add(r, key)} disabled={!ready}>
                      <Icon name="plus" size={16} /> Add to {targetName}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editId && <ItemDetail id={editId} startEditing onClose={() => setEditId(null)} />}
      {tagging && (
        <TagDialog
          title={tagging.replace ? `Replacement copy — retag “${tagging.title}”` : `Tags for “${tagging.title}”`}
          initial={tagging.tags} onClose={() => setTagging(null)} onSave={saveTags}>
          {tagging.replace && <p className="muted small">The copy count stays the same. Pick the tags this copy should have.</p>}
        </TagDialog>
      )}
    </div>
  );
}

// "You already have this" with the three choices.
export function DuplicateChoice({ owned, onReplace, onCopy, onIgnore }) {
  const where = owned.map((o) => `${o.collection_name}${o.copies > 1 ? ` (×${o.copies})` : ''}`).join(', ');
  return (
    <div className="duplicate">
      <div className="duplicate-msg"><Icon name="check" size={16} /> Already in MyLib: {where}</div>
      <div className="duplicate-actions">
        <button className="btn btn-small" onClick={onReplace}>Replacement copy — retag it</button>
        <button className="btn btn-small btn-primary" onClick={onCopy}>Add 2nd copy</button>
        <button className="btn btn-small btn-ghost" onClick={onIgnore}>Ignore</button>
      </div>
    </div>
  );
}

function ManualForm({ ready, targetBody, onAdded, onCopy, onReplace, initialIsbn = '' }) {
  const { toast } = useApp();
  const empty = { title: '', creators: '', series: '', volume: '', ean_isbn13: '', publisher: '', publish_date: '', length: '', status: '' };
  const [form, setForm] = useState({ ...empty, ean_isbn13: initialIsbn });
  const [owned, setOwned] = useState(null);
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (k === 'ean_isbn13') setOwned(null);
  };
  const submit = async (e) => {
    e.preventDefault();
    try {
      // Same ISBN already in MyLib? Ask first.
      if (form.ean_isbn13.trim() && owned === null) {
        const found = (await api.get(`/api/items/owned?isbn=${encodeURIComponent(form.ean_isbn13.trim())}`)).owned;
        if (found.length) return setOwned(found);
      }
      const item = await api.post('/api/items', { ...targetBody(), ...form });
      setForm(empty);
      setOwned(null);
      onAdded(item);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const finish = (fn) => () => {
    fn(owned[0]);
    setForm(empty);
    setOwned(null);
  };
  return (
    <form className="field-grid" onSubmit={submit}>
      <label className="field wide"><span>Title *</span><input value={form.title} onChange={set('title')} required /></label>
      <label className="field wide"><span>Author(s)</span><input value={form.creators} onChange={set('creators')} /></label>
      <label className="field"><span>Series</span><input value={form.series} onChange={set('series')} /></label>
      <label className="field"><span>Number in series</span><input value={form.volume} onChange={set('volume')} /></label>
      <label className="field"><span>ISBN</span><input value={form.ean_isbn13} onChange={set('ean_isbn13')} inputMode="numeric" /></label>
      <label className="field"><span>Publisher</span><input value={form.publisher} onChange={set('publisher')} /></label>
      <label className="field"><span>Published</span><input value={form.publish_date} onChange={set('publish_date')} placeholder="YYYY" /></label>
      <label className="field"><span>Pages</span><input value={form.length} onChange={set('length')} inputMode="numeric" /></label>
      <label className="field"><span>Status</span>
        <select value={form.status} onChange={set('status')}>
          <option value="">—</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      {owned?.length > 0 && (
        <div className="field wide">
          <DuplicateChoice owned={owned} onReplace={finish(onReplace)} onCopy={finish(onCopy)}
            onIgnore={() => { setForm(empty); setOwned(null); }} />
        </div>
      )}
      <div className="field wide row-end">
        <button className="btn btn-primary" disabled={!ready || !form.title.trim() || owned?.length > 0}><Icon name="plus" size={18} /> Add book</button>
      </div>
    </form>
  );
}
