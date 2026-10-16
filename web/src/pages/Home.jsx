import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Cover, Empty, Icon } from '../components/ui.jsx';
import { NewCollectionModal } from '../components/Layout.jsx';
import ItemDetail from '../components/ItemDetail.jsx';

export default function Home() {
  const { collections, unsorted, version } = useApp();
  const [stats, setStats] = useState(null);
  const [newColl, setNewColl] = useState(false);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get('/api/stats').then(setStats).catch(() => {});
  }, [version]);

  if (stats && !stats.items && !collections.length && !unsorted.item_count) {
    return (
      <div className="page">
        <Empty title="Your library is empty">
          <p>Start by importing your Libib export, or create a collection and add books.</p>
          <div className="row gap">
            <Link className="btn btn-primary" to="/import"><Icon name="upload" size={18} /> Import from Libib</Link>
            <button className="btn" onClick={() => setNewColl(true)}><Icon name="plus" size={18} /> New collection</button>
          </div>
        </Empty>
        {newColl && <NewCollectionModal onClose={() => setNewColl(false)} />}
      </div>
    );
  }

  return (
    <div className="page">
      <section className="stat-row">
        <div className="stat"><b>{stats?.items ?? '–'}</b><span>titles</span></div>
        <div className="stat"><b>{stats?.copies ?? '–'}</b><span>books (copies)</span></div>
        <div className="stat"><b>{collections.length}</b><span>collections</span></div>
        {stats?.statuses?.find((s) => s.status === 'Completed') && (
          <div className="stat"><b>{stats.statuses.find((s) => s.status === 'Completed').n}</b><span>read</span></div>
        )}
      </section>

      <div className="section-head">
        <h2>Collections</h2>
        <button className="btn btn-ghost" onClick={() => setNewColl(true)}><Icon name="plus" size={18} /> New</button>
      </div>
      <section className="shelf-grid">
        {unsorted.item_count > 0 && (
          <Link to="/unsorted" className="shelf-card shelf-unsorted">
            <div className="shelf-covers">
              {unsorted.covers.length ? unsorted.covers.map((src) => <img key={src} src={src} alt="" loading="lazy" />) : <Cover title="New" size="sm" />}
            </div>
            <div className="shelf-meta">
              <strong>New &amp; Unsorted</strong>
              <span className="muted small">{unsorted.item_count} {unsorted.item_count === 1 ? 'book' : 'books'} waiting to be sorted</span>
            </div>
          </Link>
        )}
        {collections.map((c) => (
          <Link key={c.id} to={`/collections/${c.id}`} className="shelf-card">
            <div className="shelf-covers">
              {c.covers.length ? c.covers.map((src) => <img key={src} src={src} alt="" loading="lazy" />) : <Cover title={c.name} size="sm" />}
            </div>
            <div className="shelf-meta">
              <strong>{c.name}</strong>
              <span className="muted small">
                {c.item_count} {c.item_count === 1 ? 'title' : 'titles'}
                {c.copy_count !== c.item_count ? ` · ${c.copy_count} copies` : ''}
              </span>
            </div>
          </Link>
        ))}
      </section>

      {!!stats?.recent?.length && (
        <>
          <div className="section-head"><h2>Recently added</h2></div>
          <section className="recent-row">
            {stats.recent.map((i) => (
              <button key={i.id} className="recent-item" onClick={() => setOpen(i.id)}>
                <Cover src={i.cover} title={i.title} size="sm" />
                <span className="truncate-2 small">{i.title}</span>
              </button>
            ))}
          </section>
        </>
      )}
      {newColl && <NewCollectionModal onClose={() => setNewColl(false)} />}
      {open && <ItemDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
