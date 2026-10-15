import { useEffect, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context.jsx';
import { api, androidBridge } from '../api.js';
import { Icon, Modal } from './ui.jsx';

export function NewCollectionModal({ onClose, onCreated }) {
  const { refreshCollections, toast } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const c = await api.post('/api/collections', { name });
      await refreshCollections();
      toast(`Created “${c.name}”`, 'success');
      onCreated?.(c);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title="New collection" onClose={onClose}>
      <form onSubmit={save} className="stack">
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Magic Tree House" required />
        </label>
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>Create</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Layout({ children }) {
  const { collections, user, onLogout } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [newColl, setNewColl] = useState(false);
  const [search, setSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setNavOpen(false), [location.pathname, location.search]);

  const total = collections.reduce((n, c) => n + c.item_count, 0);
  const currentCollection = location.pathname.match(/^\/collections\/(\d+)/)?.[1];

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(`/library?q=${encodeURIComponent(search.trim())}`);
    setSearch('');
  };

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <header className="topbar">
        <button className="icon-btn only-mobile" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">
          <Icon name="menu" />
        </button>
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>MyLib</span>
        </Link>
        <form className="topsearch" onSubmit={submitSearch} role="search">
          <Icon name="search" size={18} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your library" aria-label="Search your library" />
        </form>
        {androidBridge?.scan && (
          <button className="btn btn-accent" onClick={() => androidBridge.scan(currentCollection ? Number(currentCollection) : 0)}>
            <Icon name="camera" size={18} /> <span className="hide-sm">Scan</span>
          </button>
        )}
        <Link className="btn btn-primary" to={currentCollection ? `/add?collection=${currentCollection}` : '/add'}>
          <Icon name="plus" size={18} /> <span className="hide-sm">Add book</span>
        </Link>
      </header>

      <nav className="sidebar" aria-label="Main">
        <NavLink to="/" end className="nav-item"><Icon name="home" /> Home</NavLink>
        <NavLink to="/library" end className="nav-item"><Icon name="books" /> All books <span className="count">{total}</span></NavLink>

        <div className="nav-heading">
          <span>Collections</span>
          <button className="icon-btn small" onClick={() => setNewColl(true)} aria-label="New collection" title="New collection">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <div className="nav-collections">
          {collections.map((c) => (
            <NavLink key={c.id} to={`/collections/${c.id}`} className="nav-item">
              <Icon name="folder" size={18} /> <span className="truncate">{c.name}</span> <span className="count">{c.item_count}</span>
            </NavLink>
          ))}
          {!collections.length && <p className="muted small pad">No collections yet.</p>}
        </div>

        <div className="nav-bottom">
          <NavLink to="/import" className="nav-item"><Icon name="upload" /> Import</NavLink>
          <NavLink to="/export" className="nav-item"><Icon name="download" /> Export</NavLink>
          <NavLink to="/backups" className="nav-item"><Icon name="backup" /> Backups</NavLink>
          <NavLink to="/settings" className="nav-item"><Icon name="settings" /> Settings</NavLink>
          {onLogout && (
            <button className="nav-item" onClick={onLogout}><Icon name="logout" /> Sign out <span className="muted small">{user.username}</span></button>
          )}
        </div>
      </nav>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />

      <main className="content">{children}</main>
      {newColl && <NewCollectionModal onClose={() => setNewColl(false)} onCreated={(c) => navigate(`/collections/${c.id}`)} />}
    </div>
  );
}
