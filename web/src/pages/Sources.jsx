// Sources.jsx — where book details come from, and in what order.
// Sources are asked one at a time, top to bottom, until the book has a title,
// author, cover and description.

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Icon } from '../components/ui.jsx';

const HELP = {
  openlibrary: 'Free, no key, no daily limit. Covers, series and most ISBNs.',
  hardcover: 'Free token from hardcover.app → Settings → Hardcover API. Series, descriptions, covers. 5,000 calls a day.',
  google: 'Free key from Google Cloud (Books API). Titles, descriptions, publishers. 1,000 calls a day.',
  isbndb: 'Paid subscription. The most complete retail data.',
  nyt: 'Free key from developer.nytimes.com. Only knows NYT bestseller lists and reviews — used to mark bestsellers.',
  ai: 'Reads cover photos from the phone to identify books.',
};

export default function Sources() {
  const { toast } = useApp();
  const [sources, setSources] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/lookup/providers').then((d) => setSources(d.providers)).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const metadata = sources.filter((s) => s.kind === 'metadata');
  const extras = sources.filter((s) => s.kind === 'extra');

  const save = async (changes) => {
    setSaving(true);
    try {
      setSources((await api.put('/api/lookup/providers', changes)).providers);
    } catch (err) {
      toast(err.message, 'error');
    }
    setSaving(false);
  };
  const offList = (id, on) => sources.filter((s) => (s.id === id ? !on : !s.on)).map((s) => s.id);

  const move = (index, delta) => {
    const order = metadata.map((s) => s.id);
    const [id] = order.splice(index, 1);
    order.splice(index + delta, 0, id);
    // Show the new order straight away; the server confirms it.
    setSources([...order.map((x) => metadata.find((s) => s.id === x)), ...extras]);
    save({ order });
  };

  return (
    <div className="page narrow">
      <h1>Book sources</h1>
      <p className="muted">
        When you scan or search for a book, MyLib asks these sources <b>one at a time, top to bottom</b>, and stops as soon as
        it has the title, author, cover and description. Sources that are off, have no key, or have used up today's calls
        are skipped. Keys go in the <code>.env</code> file next to <code>docker-compose.yml</code> (restart the container after
        changing them).
      </p>

      <section className="card stack">
        <h2>Order for book details</h2>
        <ol className="source-order">
          {metadata.map((s, i) => (
            <SourceRow key={s.id} source={s} position={i + 1}
              controls={
                <div className="order-buttons">
                  <button className="icon-btn small" aria-label={`Move ${s.name} up`} disabled={i === 0 || saving} onClick={() => move(i, -1)}>
                    <Icon name="chevron" size={16} className="rot-up" />
                  </button>
                  <button className="icon-btn small" aria-label={`Move ${s.name} down`} disabled={i === metadata.length - 1 || saving} onClick={() => move(i, 1)}>
                    <Icon name="chevron" size={16} className="rot90" />
                  </button>
                </div>
              }
              onToggle={(on) => save({ off: offList(s.id, on) })} />
          ))}
        </ol>
      </section>

      <section className="card stack">
        <h2>Extras</h2>
        <ul className="source-order">
          {extras.map((s) => (
            <SourceRow key={s.id} source={s} onToggle={(on) => save({ off: offList(s.id, on) })}>
              {s.id === 'nyt' && (
                <label className="radio small">
                  <input type="checkbox" checked={!!s.tag} disabled={!s.enabled || !s.on} onChange={(e) => save({ nyt_tag: e.target.checked })} />
                  <span>Tag bestsellers “NYT Bestseller” when they're added</span>
                </label>
              )}
            </SourceRow>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SourceRow({ source, position, controls, onToggle, children }) {
  const [result, setResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const usage = source.usage;

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
    <li className={`source ${source.enabled && source.on ? '' : 'source-off'}`}>
      <div className="source-head">
        {position && <span className="source-pos">{position}</span>}
        <div className="source-name">
          <b>{source.name}</b>
          <span className="muted small">
            {source.env ? (source.enabled ? <>Key <code>{source.key}</code></> : <>No key — set <code>{source.env}</code></>) : 'No key needed'}
            {usage && (
              <> · {usage.limit ? `${usage.used.toLocaleString()} of ${usage.limit.toLocaleString()} calls today` : `${usage.used.toLocaleString()} calls today`}
                {usage.paused && <b className="danger"> · paused (too many requests)</b>}
                {!!usage.limit && usage.used >= usage.limit && <b className="danger"> · limit reached until tomorrow</b>}
              </>
            )}
          </span>
        </div>
        {controls}
        <label className="switch" title={source.on ? 'On' : 'Off'}>
          <input type="checkbox" checked={source.on && source.enabled} disabled={!source.enabled} onChange={(e) => onToggle(e.target.checked)}
            aria-label={`Use ${source.name}`} />
          <span />
        </label>
        <button className="btn btn-small" onClick={test} disabled={testing || !source.enabled}>
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      <p className="muted small source-help">{HELP[source.id]}</p>
      {children && <div className="source-help">{children}</div>}
      {result && (
        <p className={`test-result ${result.ok ? 'ok' : 'fail'}`} role="status">
          {result.ok ? '✓' : '✗'} {result.message}{result.ms != null ? ` (${(result.ms / 1000).toFixed(1)} s)` : ''}
        </p>
      )}
    </li>
  );
}
