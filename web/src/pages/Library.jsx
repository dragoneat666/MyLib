// Library.jsx — browse a collection (/collections/:id), New & Unsorted (/unsorted)
// or the whole library (/library, optionally ?tag=… or ?q=…).

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs, prefs, STATUSES } from '../api.js';
import { useApp, UNSORTED } from '../context.jsx';
import { Cover, Empty, Icon, Modal, Stars, TagDialog } from '../components/ui.jsx';
import ItemDetail from '../components/ItemDetail.jsx';

const PAGE = 60;

export default function Library({ unsortedView = false }) {
  const { id } = useParams();
  const collectionId = id ? Number(id) : null;
  const [params, setParams] = useSearchParams();
  const { collections, unsorted, tags, version, toast, libraryChanged } = useApp();
  const navigate = useNavigate();
  const tag = params.get('tag') || '';

  const q = params.get('q') || '';
  const sort = params.get('sort') || prefs.get('sort', 'title');
  const dir = params.get('dir') || 'asc';
  const status = params.get('status') || '';
  const [view, setView] = useState(prefs.get('view', 'grid'));
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [selecting, setSelecting] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [filter, setFilter] = useState(q);

  const collection = collections.find((c) => c.id === collectionId);

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const collection = unsortedView ? 'unsorted' : collectionId;
      const data = await api.get(`/api/items?${qs({ collection, q, sort, dir, status, tag, limit: PAGE, offset })}`);
      setTotal(data.total);
      setItems((prev) => (offset ? [...prev, ...data.items] : data.items));
    } catch (err) {
      toast(err.message, 'error');
    }
    setLoading(false);
  }, [collectionId, unsortedView, q, sort, dir, status, tag, toast]);

  useEffect(() => {
    load(0);
  }, [load, version]);

  useEffect(() => {
    setFilter(q);
    setSelected(new Set());
    setSelecting(false);
  }, [collectionId, unsortedView, q, tag]);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (changes.sort) prefs.set('sort', changes.sort);
    setParams(next, { replace: true });
  };

  const toggle = (itemId) => setSelected((s) => {
    const n = new Set(s);
    n.has(itemId) ? n.delete(itemId) : n.add(itemId);
    return n;
  });

  const bulk = async (action, extra = {}) => {
    try {
      const r = await api.post('/api/items/bulk', { ids: [...selected], action, ...extra });
      toast(`Updated ${r.count} ${r.count === 1 ? 'book' : 'books'}`, 'success');
      setSelected(new Set());
      setSelecting(false);
      setDialog(null);
      libraryChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const title = unsortedView ? UNSORTED.name : collection ? collection.name : tag ? `Tag: ${tag}` : q ? `Search: “${q}”` : 'All books';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            {total} {total === 1 ? 'title' : 'titles'}
            {collection && collection.copy_count !== collection.item_count ? ` · ${collection.copy_count} copies` : ''}
          </p>
          {unsortedView && <p className="muted small">New books land here until you move them into a collection (Select → Move).</p>}
        </div>
        {unsortedView && (
          <div className="row gap wrap">
            <Link className="btn" to="/add"><Icon name="plus" size={18} /> Add</Link>
            <a className="btn" href="/api/export/csv?collection_id=unsorted"><Icon name="download" size={18} /> Export CSV</a>
          </div>
        )}
        {collection && (
          <div className="row gap wrap">
            <Link className="btn" to={`/add?collection=${collection.id}`}><Icon name="plus" size={18} /> Add</Link>
            <a className="btn" href={`/api/export/csv?collection_id=${collection.id}`}><Icon name="download" size={18} /> Export CSV</a>
            <button className="btn btn-ghost" onClick={() => setDialog('rename')}><Icon name="edit" size={18} /> Rename</button>
            <button className="btn btn-ghost danger" onClick={() => setDialog('delete')}><Icon name="trash" size={18} /></button>
          </div>
        )}
      </div>

      <div className="toolbar">
        <form className="filter-box" onSubmit={(e) => { e.preventDefault(); update({ q: filter.trim() }); }}>
          <Icon name="search" size={16} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={collection ? `Search ${collection.name}` : 'Title, author, series, ISBN…'} />
          {q && <button type="button" className="icon-btn small" onClick={() => update({ q: '' })} aria-label="Clear search"><Icon name="close" size={14} /></button>}
        </form>
        <select value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort by">
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="series">Series</option>
          <option value="added">Date added</option>
          <option value="published">Published</option>
          <option value="rating">Rating</option>
        </select>
        <button className="icon-btn" onClick={() => update({ dir: dir === 'asc' ? 'desc' : 'asc' })} title={dir === 'asc' ? 'Ascending' : 'Descending'} aria-label="Reverse order">
          <Icon name="sort" className={dir === 'desc' ? 'flip' : ''} />
        </button>
        <select value={status} onChange={(e) => update({ status: e.target.value })} aria-label="Reading status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
          <option value="none">No status</option>
        </select>
        <select value={tag} onChange={(e) => update({ tag: e.target.value })} aria-label="Tag">
          <option value="">Any tag</option>
          {tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          {tag && !tags.some((t) => t.name === tag) && <option value={tag}>{tag}</option>}
        </select>
        <div className="seg">
          <button className={view === 'grid' ? 'on' : ''} onClick={() => { setView('grid'); prefs.set('view', 'grid'); }} aria-label="Cover view"><Icon name="grid" size={18} /></button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => { setView('list'); prefs.set('view', 'list'); }} aria-label="List view"><Icon name="list" size={18} /></button>
        </div>
        <button className={`btn btn-ghost ${selecting ? 'on' : ''}`} onClick={() => { setSelecting((s) => !s); setSelected(new Set()); }}>
          {selecting ? 'Done' : 'Select'}
        </button>
      </div>

      {selecting && (
        <div className="bulkbar">
          <span>{selected.size} selected</span>
          <button className="btn btn-small" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>Select all shown</button>
          <span className="spacer" />
          <button className="btn btn-small" disabled={!selected.size} onClick={() => setDialog('move')}>Move…</button>
          <button className="btn btn-small" disabled={!selected.size} onClick={() => setDialog('status')}>Status…</button>
          <button className="btn btn-small" disabled={!selected.size} onClick={() => setDialog('tag')}>Add tags…</button>
          <button className="btn btn-small" disabled={!selected.size} onClick={() => setDialog('untag')}>Remove tags…</button>
          <button className="btn btn-small" disabled={!selected.size} onClick={() => bulk('fetch_covers')}>Find covers</button>
          <button className="btn btn-small danger" disabled={!selected.size}
            onClick={() => confirm(`Delete ${selected.size} books?`) && bulk('delete')}>Delete</button>
        </div>
      )}

      {!loading && !items.length ? (
        <Empty title={q || status || tag ? 'No matches' : unsortedView ? 'Nothing waiting to be sorted' : 'No books here yet'}>
          {collection && <Link className="btn btn-primary" to={`/add?collection=${collection.id}`}><Icon name="plus" size={18} /> Add a book</Link>}
        </Empty>
      ) : view === 'grid' ? (
        <div className="cover-grid">
          {items.map((it) => (
            <button key={it.id} className={`book-card ${selected.has(it.id) ? 'selected' : ''}`}
              onClick={() => (selecting ? toggle(it.id) : setOpen(it.id))}>
              <div className="book-cover-wrap">
                <Cover src={it.cover} title={it.title} />
                {selecting && <span className="check">{selected.has(it.id) && <Icon name="check" size={16} />}</span>}
                {it.copies > 1 && <span className="badge">×{it.copies}</span>}
              </div>
              <span className="book-title truncate-2">{it.title}</span>
              <span className="book-author truncate">{it.creators}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="book-table">
            <thead>
              <tr>
                {selecting && <th />}
                <th />
                <th>Title</th>
                <th>Author</th>
                {!collection && !unsortedView && <th className="hide-sm">Collection</th>}
                <th className="hide-sm">Published</th>
                <th className="hide-sm">Status</th>
                <th className="hide-sm">Rating</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className={selected.has(it.id) ? 'selected' : ''} onClick={() => (selecting ? toggle(it.id) : setOpen(it.id))}>
                  {selecting && <td><input type="checkbox" readOnly checked={selected.has(it.id)} aria-label="Select" /></td>}
                  <td className="thumb"><Cover src={it.cover} title={it.title} size="xs" /></td>
                  <td>
                    <strong>{it.title}</strong>
                    {it.series && <div className="muted small">{it.series}{it.volume ? ` #${it.volume}` : ''}</div>}
                  </td>
                  <td>{it.creators}</td>
                  {!collection && !unsortedView && <td className="hide-sm">{it.collection_name}</td>}
                  <td className="hide-sm">{it.publish_date?.slice(0, 4)}</td>
                  <td className="hide-sm">{it.status}</td>
                  <td className="hide-sm">{Number(it.rating) > 0 && <Stars value={it.rating} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length < total && (
        <div className="center pad">
          <button className="btn" disabled={loading} onClick={() => load(items.length)}>
            {loading ? 'Loading…' : `Show more (${total - items.length} left)`}
          </button>
        </div>
      )}

      {open && <ItemDetail id={open} onClose={() => setOpen(null)} />}

      {dialog === 'move' && (
        <PickDialog title={`Move ${selected.size} books`} label="To collection" onClose={() => setDialog(null)}
          options={[
            ...(unsortedView ? [] : [[0, UNSORTED.name]]),
            ...collections.filter((c) => c.id !== collectionId).map((c) => [c.id, c.name]),
          ]}
          onPick={(v) => bulk('move', { collection_id: Number(v) })} />
      )}
      {dialog === 'status' && (
        <PickDialog title="Set reading status" label="Status" onClose={() => setDialog(null)}
          options={[['', '— none —'], ...STATUSES.map((s) => [s, s])]} onPick={(v) => bulk('status', { status: v })} />
      )}
      {dialog === 'tag' && (
        <TagDialog title={`Add tags to ${selected.size} ${selected.size === 1 ? 'book' : 'books'}`} saveLabel="Add tags"
          onClose={() => setDialog(null)}
          onSave={(list) => (list.length ? bulk('add_tags', { tags: list }) : setDialog(null))} />
      )}
      {dialog === 'untag' && (
        <TagDialog title={`Remove tags from ${selected.size} ${selected.size === 1 ? 'book' : 'books'}`} saveLabel="Remove tags"
          onClose={() => setDialog(null)}
          onSave={(list) => (list.length ? bulk('remove_tags', { tags: list }) : setDialog(null))}>
          <p className="muted small">Pick the tags to take off the selected books.</p>
        </TagDialog>
      )}
      {dialog === 'rename' && collection && (
        <TextDialog title="Rename collection" label="Name" initial={collection.name} onClose={() => setDialog(null)}
          onSave={async (name) => {
            try {
              await api.put(`/api/collections/${collection.id}`, { name, description: collection.description });
              libraryChanged();
              setDialog(null);
            } catch (err) {
              toast(err.message, 'error');
            }
          }} />
      )}
      {dialog === 'delete' && collection && (
        <DeleteCollection collection={collection} others={collections.filter((c) => c.id !== collection.id)}
          onClose={() => setDialog(null)}
          onDeleted={() => { libraryChanged(); navigate('/'); }} />
      )}
    </div>
  );
}

function PickDialog({ title, label, options, onPick, onClose }) {
  const [value, setValue] = useState(options[0]?.[0] ?? '');
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <label className="field">
          <span>{label}</span>
          <select value={value} onChange={(e) => setValue(e.target.value)}>
            {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="row-end">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onPick(value)} disabled={!options.length}>Apply</button>
        </div>
      </div>
    </Modal>
  );
}

function TextDialog({ title, label, initial = '', onSave, onClose }) {
  const [value, setValue] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(value.trim()); }}>
        <label className="field">
          <span>{label}</span>
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} required />
        </label>
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!value.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteCollection({ collection, others, onClose, onDeleted }) {
  const { toast } = useApp();
  const [mode, setMode] = useState(collection.item_count ? 'move' : 'delete');
  const [target, setTarget] = useState('unsorted');
  const go = async () => {
    try {
      const query = !collection.item_count ? '' : mode === 'move' ? `?move_to=${target}` : '?delete_items=1';
      await api.del(`/api/collections/${collection.id}${query}`);
      toast(`Deleted “${collection.name}”`);
      onDeleted();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Modal title={`Delete “${collection.name}”?`} onClose={onClose}>
      <div className="stack">
        {collection.item_count > 0 ? (
          <>
            <p>This collection has {collection.item_count} books. What should happen to them?</p>
            <label className="radio">
              <input type="radio" checked={mode === 'move'} onChange={() => setMode('move')} />
              Move them to
              <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={mode !== 'move'}>
                <option value="unsorted">{UNSORTED.name}</option>
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="radio">
              <input type="radio" checked={mode === 'delete'} onChange={() => setMode('delete')} />
              Delete the books too
            </label>
          </>
        ) : (
          <p>The collection is empty.</p>
        )}
        <div className="row-end">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={go}>Delete collection</button>
        </div>
      </div>
    </Modal>
  );
}
