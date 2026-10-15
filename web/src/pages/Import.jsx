// Import.jsx — bring in a Libib CSV export.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { CollectionSelect, Icon } from '../components/ui.jsx';

export default function ImportPage() {
  const { toast, libraryChanged, refreshCollections } = useApp();
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('csv');
  const [target, setTarget] = useState({ id: null });
  const [duplicates, setDuplicates] = useState('skip');
  const [covers, setCovers] = useState(true);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [coverStatus, setCoverStatus] = useState(null);

  const form = (dryRun) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', mode);
    if (mode === 'single') {
      if (target.newName) fd.append('new_collection', target.newName.trim());
      else if (target.id) fd.append('collection_id', target.id);
    }
    fd.append('duplicates', duplicates);
    fd.append('fetch_covers', String(covers));
    fd.append('dry_run', String(dryRun));
    return fd;
  };

  const run = async (dryRun) => {
    setBusy(true);
    try {
      const r = await api.post('/api/import/libib', form(dryRun));
      if (dryRun) setPreview(r);
      else {
        setResult(r);
        setPreview(null);
        await refreshCollections();
        libraryChanged();
        toast(`Imported ${r.created} new, ${r.updated} updated`, 'success');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  // Show cover download progress after an import.
  useEffect(() => {
    if (!result?.covers_queued) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.get('/api/import/covers/status');
        if (stop) return;
        setCoverStatus(s);
        if (s.running || s.pending) setTimeout(tick, 2000);
        else libraryChanged();
      } catch {
        // ignore
      }
    };
    tick();
    return () => {
      stop = true;
    };
  }, [result, libraryChanged]);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setCoverStatus(null);
  };

  return (
    <div className="page narrow">
      <h1>Import from Libib</h1>
      <p className="muted">
        In Libib, open <b>Settings → Import/Export</b> and export a library or collection as CSV, then choose that file here.
        Importing the same file again is safe — books you already have are skipped.
      </p>

      <div className="card stack">
        <label className="field">
          <span>Libib CSV file</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files[0] || null); reset(); }} />
        </label>

        <fieldset className="stack-sm">
          <legend>Which collection should the books go in?</legend>
          <label className="radio">
            <input type="radio" checked={mode === 'csv'} onChange={() => { setMode('csv'); reset(); }} />
            <span>Use the <b>collection</b> column from the file (collections are created as needed)</span>
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'single'} onChange={() => { setMode('single'); reset(); }} />
            <span>Put everything in one collection:</span>
          </label>
          {mode === 'single' && (
            <div className="indent">
              <CollectionSelect value={target.id} onChange={(t) => { setTarget(t); reset(); }} />
            </div>
          )}
        </fieldset>

        <fieldset className="stack-sm">
          <legend>If a book is already in MyLib</legend>
          {[
            ['skip', 'Skip it (recommended)'],
            ['update', 'Update it with the details from the file'],
            ['add', 'Add it again anyway'],
          ].map(([v, label]) => (
            <label key={v} className="radio">
              <input type="radio" checked={duplicates === v} onChange={() => { setDuplicates(v); reset(); }} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <label className="radio">
          <input type="checkbox" checked={covers} onChange={(e) => setCovers(e.target.checked)} />
          <span>Download cover pictures afterwards (Libib exports don't include them)</span>
        </label>

        <div className="row gap">
          <button className="btn" disabled={!file || busy} onClick={() => run(true)}>Preview</button>
          <button className="btn btn-primary" disabled={!file || busy || (mode === 'single' && !target.id && !target.newName?.trim())}
            onClick={() => run(false)}>
            <Icon name="upload" size={18} /> {busy ? 'Working…' : 'Import'}
          </button>
        </div>
      </div>

      {(preview || result) && <Summary data={preview || result} />}

      {coverStatus && (coverStatus.total > 0) && (
        <div className="card">
          <b>Covers:</b> {coverStatus.done} of {coverStatus.total} checked, {coverStatus.found} found
          {coverStatus.running ? '…' : ' — done.'}
          <div className="progress"><div style={{ width: `${(100 * coverStatus.done) / Math.max(1, coverStatus.total)}%` }} /></div>
        </div>
      )}
    </div>
  );
}

function Summary({ data }) {
  return (
    <div className="card stack">
      <h3>{data.dry_run ? 'Preview — nothing has been changed yet' : 'Import finished'}</h3>
      <div className="stat-row compact">
        <div className="stat"><b>{data.total}</b><span>rows</span></div>
        <div className="stat"><b>{data.created}</b><span>{data.dry_run ? 'would be added' : 'added'}</span></div>
        <div className="stat"><b>{data.updated}</b><span>{data.dry_run ? 'would be updated' : 'updated'}</span></div>
        <div className="stat"><b>{data.skipped}</b><span>skipped</span></div>
      </div>
      <table className="simple-table">
        <thead><tr><th>Collection</th><th>Added</th><th>Updated</th><th>Skipped</th></tr></thead>
        <tbody>
          {data.collections.map((c) => (
            <tr key={c.name}>
              <td>{c.name} {c.new && <span className="chip">new</span>}</td>
              <td>{c.created}</td><td>{c.updated}</td><td>{c.skipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.errors?.length > 0 && (
        <details>
          <summary>{data.errors.length} rows had problems</summary>
          <ul>{data.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>
        </details>
      )}
      {!data.dry_run && <Link to="/" className="btn">Go to library</Link>}
    </div>
  );
}
