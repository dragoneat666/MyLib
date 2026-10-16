// Settings.jsx — book sources link, tags, Android app.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, androidBridge } from '../api.js';
import { useApp } from '../context.jsx';
import { Icon } from '../components/ui.jsx';

export default function Settings() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api.get('/api/info').then(setInfo).catch(() => {});
  }, []);

  return (
    <div className="page narrow">
      <h1>Settings</h1>

      <section className="card stack">
        <h2>Book sources</h2>
        <p className="muted small">Which services MyLib asks for book details, in what order, how many calls they've used today, and a Test button for each.</p>
        <Link className="btn" to="/sources"><Icon name="books" size={18} /> Open Book sources</Link>
      </section>

      <TagsSection />

      <section className="card stack">
        <h2>Android app</h2>
        <p>
          The phone app shows this same library and adds a camera mode: point it at a barcode or a cover and it finds the book.
        </p>
        <ol className="steps">
          <li>On the phone, open <b>{window.location.origin}/download/mylib.apk</b> (or tap the button below) and install it.
            Android will ask to allow installing apps from your browser.</li>
          <li>Open MyLib and enter the server address — the same address you use in the browser, e.g. your NetBird IP
            and port like <code>http://100.x.y.z:14100</code>.</li>
        </ol>
        <div className="row gap wrap">
          {info?.apk ? (
            <a className="btn btn-primary" href="/download/mylib.apk"><Icon name="download" size={18} /> Download the Android app</a>
          ) : (
            <p className="muted small">This server build doesn't include the APK — download it from the GitHub release instead.</p>
          )}
          {androidBridge?.changeServer && (
            <button className="btn" onClick={() => androidBridge.changeServer()}>Change server address</button>
          )}
        </div>
      </section>

      <p className="muted small center">MyLib {info?.version}</p>
    </div>
  );
}

// Settings → Tags: the shared tag list. Renaming changes every book with that tag;
// renaming to an existing tag's name merges them.
function TagsSection() {
  const { tags, toast, libraryChanged } = useApp();
  const [editing, setEditing] = useState(null); // { id, name }
  const [draft, setDraft] = useState('');

  const call = async (fn, message) => {
    try {
      await fn();
      libraryChanged();
      if (message) toast(message, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const create = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    call(() => api.post('/api/tags', { name: draft }), `Added tag “${draft.trim()}”`);
    setDraft('');
  };
  const rename = (e) => {
    e.preventDefault();
    call(() => api.put(`/api/tags/${editing.id}`, { name: editing.name }), 'Tag renamed');
    setEditing(null);
  };
  const remove = (t) => {
    if (!confirm(`Delete the tag “${t.name}”? It will be removed from ${t.count} ${t.count === 1 ? 'book' : 'books'}.`)) return;
    call(() => api.del(`/api/tags/${t.id}`), `Deleted “${t.name}”`);
  };

  return (
    <section className="card stack">
      <h2>Tags</h2>
      <p className="muted small">
        Tags are shared: once a tag exists, it's offered everywhere you tag books. Renaming a tag changes it on every book;
        renaming it to the name of another tag merges the two.
      </p>
      <table className="simple-table">
        <tbody>
          {tags.map((t) => (
            <tr key={t.id}>
              <td>
                {editing?.id === t.id ? (
                  <form className="row gap" onSubmit={rename}>
                    <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    <button className="btn btn-small btn-primary" disabled={!editing.name.trim()}>Save</button>
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <Link to={`/library?tag=${encodeURIComponent(t.name)}`}><Icon name="tag" size={16} /> {t.name}</Link>
                )}
              </td>
              <td className="muted small">{t.count} {t.count === 1 ? 'book' : 'books'}</td>
              <td className="right nowrap">
                {editing?.id !== t.id && (
                  <>
                    <button className="btn btn-small" onClick={() => setEditing({ id: t.id, name: t.name })}>Rename</button>{' '}
                    <button className="btn btn-small danger" onClick={() => remove(t)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!tags.length && <tr><td className="muted">No tags yet.</td></tr>}
        </tbody>
      </table>
      <form className="row gap" onSubmit={create}>
        <input value={draft} placeholder="New tag" maxLength={60} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn btn-primary" disabled={!draft.trim()}><Icon name="plus" size={18} /> Add tag</button>
      </form>
    </section>
  );
}
