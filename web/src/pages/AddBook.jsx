// AddBook.jsx — add books by ISBN / title search, or by typing them in.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, prefs, androidBridge, STATUSES } from '../api.js';
import { useApp } from '../context.jsx';
import { CollectionSelect, Cover, Icon } from '../components/ui.jsx';
import ItemDetail from '../components/ItemDetail.jsx';

export default function AddBook() {
  const { collections, toast, libraryChanged, refreshCollections } = useApp();
  const [params] = useSearchParams();
  const initialColl = Number(params.get('collection')) || prefs.get('lastCollection', null);
  const [target, setTarget] = useState({ id: initialColl });
  const [query, setQuery] = useState(params.get('q') || '');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState({}); // result key -> item id
  const [editId, setEditId] = useState(null);
  const [manual, setManual] = useState(false);
  const inputRef = useRef(null);

  // Default to a real collection once the list has loaded.
  useEffect(() => {
    if (!('newName' in target) && !collections.some((c) => c.id === target.id) && collections.length) {
      setTarget({ id: collections[0].id });
    }
  }, [collections, target]);

  useEffect(() => {
    const c = Number(params.get('collection'));
    if (c) setTarget({ id: c });
    // ?q=… (e.g. from the phone scanner) searches straight away.
    const q = params.get('q');
    if (q) {
      setQuery(q);
      search(null, q);
    }
  }, [params]);

  const targetName = target.newName?.trim() || collections.find((c) => c.id === target.id)?.name;
  const targetBody = () => (target.newName ? { collection_name: target.newName.trim() } : { collection_id: target.id });
  const ready = !!(target.newName?.trim() || target.id);

  const search = async (e, text = query) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q) return;
    setSearching(true);
    setResults(null);
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
      setTarget({ id: item.collection_id });
    }
    prefs.set('lastCollection', item.collection_id);
    libraryChanged();
  };

  const add = async (r, key) => {
    if (!ready) return toast('Choose a collection first', 'error');
    try {
      const item = await api.post('/api/items', { ...targetBody(), metadata: r });
      setAdded((a) => ({ ...a, [key]: item.id }));
      toast(`Added to ${item.collection_name}`, 'success');
      await afterAdd(item);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const addCopy = async (owned) => {
    try {
      const item = await api.post(`/api/items/${owned.id}/copies`, { delta: 1 });
      toast(`${item.title}: now ${item.copies} copies`, 'success');
      libraryChanged();
      search();
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
          <span>Add to collection</span>
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
        {manual && <ManualForm initialIsbn={/^[\dXx-]{10,17}$/.test(query.trim()) ? query.trim() : ''} ready={ready} targetBody={targetBody} onAdded={async (item) => {
          toast(`Added to ${item.collection_name}`, 'success');
          await afterAdd(item);
          setEditId(item.id);
        }} />}
      </div>

      {searching && <p className="muted center pad">Looking that up…</p>}
      {results && !results.length && <p className="muted center pad">Nothing found. Try fewer words, the ISBN, or enter it by hand.</p>}
      {results?.length > 0 && (
        <ul className="results">
          {results.map((r, i) => {
            const key = r.isbn13 || `${r.title}-${i}`;
            return (
              <li key={key} className="result">
                <Cover src={r.cover_url} title={r.title} size="sm" />
                <div className="result-info">
                  <strong>{r.title}{r.subtitle ? `: ${r.subtitle}` : ''}</strong>
                  {r.authors?.length > 0 && <span>{r.authors.join(', ')}</span>}
                  <span className="muted small">
                    {[r.publisher, r.publish_date, r.pages && `${r.pages} pages`, r.isbn13].filter(Boolean).join(' · ')}
                  </span>
                  {r.owned?.length > 0 && (
                    <div className="owned">
                      <Icon name="check" size={16} /> You have this in{' '}
                      {r.owned.map((o) => `${o.collection_name}${o.copies > 1 ? ` (×${o.copies})` : ''}`).join(', ')}
                      <button className="btn btn-small" onClick={() => addCopy(r.owned[0])}>+1 copy</button>
                    </div>
                  )}
                </div>
                <div className="result-actions">
                  {added[key] ? (
                    <button className="btn btn-small" onClick={() => setEditId(added[key])}><Icon name="edit" size={16} /> Edit</button>
                  ) : (
                    <button className="btn btn-primary btn-small" onClick={() => add(r, key)} disabled={!ready}>
                      <Icon name="plus" size={16} /> Add{targetName ? ` to ${targetName}` : ''}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editId && <ItemDetail id={editId} startEditing onClose={() => setEditId(null)} />}
    </div>
  );
}

function ManualForm({ ready, targetBody, onAdded, initialIsbn = '' }) {
  const { toast } = useApp();
  const empty = { title: '', creators: '', series: '', volume: '', ean_isbn13: '', publisher: '', publish_date: '', length: '', status: '' };
  const [form, setForm] = useState({ ...empty, ean_isbn13: initialIsbn });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      const item = await api.post('/api/items', { ...targetBody(), ...form });
      setForm(empty);
      onAdded(item);
    } catch (err) {
      toast(err.message, 'error');
    }
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
      <div className="field wide row-end">
        <button className="btn btn-primary" disabled={!ready || !form.title.trim()}><Icon name="plus" size={18} /> Add book</button>
      </div>
    </form>
  );
}
