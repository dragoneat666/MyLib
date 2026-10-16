// Settings.jsx — Android app, book information sources (with Test buttons).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, androidBridge } from '../api.js';
import { useApp } from '../context.jsx';
import { Icon } from '../components/ui.jsx';

const SOURCE_HELP = {
  openlibrary: 'Free and always on. Covers, series and most ISBNs.',
  google: 'Free key, 1,000 lookups a day. Better titles and descriptions.',
  isbndb: 'Paid. The most complete retail data.',
  ai: 'Reads cover photos from the phone to identify books.',
};

export default function Settings() {
  const [info, setInfo] = useState(null);
  const [providers, setProviders] = useState([]);
  useEffect(() => {
    api.get('/api/info').then(setInfo).catch(() => {});
    api.get('/api/lookup/providers').then((d) => setProviders(d.providers)).catch(() => {});
  }, []);

  return (
    <div className="page narrow">
      <h1>Settings</h1>

      <section className="card stack">
        <h2>Book information sources</h2>
        <p className="muted small">
          Keys are set in the <code>.env</code> file next to <code>docker-compose.yml</code>; restart the container after changing them.
          <b> Test</b> looks up a sample book (Dinosaurs Before Dark) to check the source works.
        </p>
        <ul className="source-list">
          {providers.map((p) => <SourceRow key={p.id} source={p} />)}
        </ul>
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

function SourceRow({ source }) {
  const [result, setResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.post(`/api/lookup/providers/${source.id}/test`));
    } catch (err) {
      setResult({ ok: false, message: err.message });
    }
    setTesting(false);
  };

  return (
    <li className="source">
      <div className="source-head">
        <span className={`dot ${source.enabled ? 'on' : ''}`} aria-hidden="true" />
        <div className="source-name">
          <b>{source.name}</b>
          <span className="muted small">
            {source.env ? (source.enabled ? <>Key <code>{source.key}</code></> : <>Off — set <code>{source.env}</code></>) : 'No key needed'}
          </span>
        </div>
        <button className="btn btn-small" onClick={test} disabled={testing || !source.enabled}>
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      <p className="muted small source-help">{SOURCE_HELP[source.id]}</p>
      {result && (
        <p className={`test-result ${result.ok ? 'ok' : 'fail'}`} role="status">
          {result.ok ? '✓' : '✗'} {result.message}{result.ms != null ? ` (${(result.ms / 1000).toFixed(1)} s)` : ''}
        </p>
      )}
    </li>
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
