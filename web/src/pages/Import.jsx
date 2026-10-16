// Import.jsx — bring in a Libib CSV export. Books already in MyLib are listed
// afterwards so she can choose: replacement copy (retag), add a 2nd copy, or ignore.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { CollectionSelect, Cover, Icon, TagPicker, tagList } from '../components/ui.jsx';

const DUPLICATE_OPTIONS = [
  ['ask', 'Ask me about each one (recommended)'],
  ['copy', 'Add another copy'],
  ['replace', 'Replacement copy — update its details from the file'],
  ['ignore', 'Ignore it'],
];

export default function ImportPage() {
  const { toast, libraryChanged, refreshCollections } = useApp();
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('csv');
  const [target, setTarget] = useState({ id: 0 });
  const [duplicates, setDuplicates] = useState('ask');
  const [covers, setCovers] = useState(true);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [resolved, setResolved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [coverStatus, setCoverStatus] = useState(null);

  const form = (dryRun) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', mode);
    if (mode === 'single') {
      if (target.newName) fd.append('new_collection', target.newName.trim());
      else fd.append('collection_id', target.id ? String(target.id) : 'unsorted');
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
        setResolved(null);
        setPreview(null);
        await refreshCollections();
        libraryChanged();
        toast(`Imported ${r.created} new${r.conflicts.length ? ` — ${r.conflicts.length} already in MyLib, see below` : ''}`, 'success');
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
    setResolved(null);
    setCoverStatus(null);
  };

  const conflicts = result?.conflicts || [];

  return (
    <div className="page narrow">
      <h1>Import from Libib</h1>
      <p className="muted">
        In Libib, open <b>Settings → Import/Export</b> and export a library or collection as CSV, then choose that file here.
        Importing the same file again is safe — books already imported from it are skipped.
      </p>

      <div className="card stack">
        <label className="field">
          <span>Libib CSV file</span>
          <input type="file" accept=".csv,text/csv,text/comma-separated-values" onChange={(e) => { setFile(e.target.files[0] || null); reset(); }} />
        </label>

        <fieldset className="stack-sm">
          <legend>Which collection should the books go in?</legend>
          <label className="radio">
            <input type="radio" checked={mode === 'csv'} onChange={() => { setMode('csv'); reset(); }} />
            <span>Use the <b>collection</b> column from the file (books without one go to New &amp; Unsorted)</span>
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'single'} onChange={() => { setMode('single'); reset(); }} />
            <span>Put everything in:</span>
          </label>
          {mode === 'single' && (
            <div className="indent">
              <CollectionSelect value={target.id} onChange={(t) => { setTarget(t); reset(); }} />
            </div>
          )}
        </fieldset>

        <fieldset className="stack-sm">
          <legend>If a book is already in MyLib</legend>
          {DUPLICATE_OPTIONS.map(([v, label]) => (
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
          <button className="btn btn-primary" disabled={!file || busy || (mode === 'single' && 'newName' in target && !target.newName.trim())}
            onClick={() => run(false)}>
            <Icon name="upload" size={18} /> {busy ? 'Working…' : 'Import'}
          </button>
        </div>
      </div>

      {(preview || result) && <Summary data={preview || result} />}

      {result && conflicts.length > 0 && !resolved && (
        <ConflictReview conflicts={conflicts} onDone={async (r) => {
          setResolved(r);
          libraryChanged();
          toast(`Done: ${r.copies_added} extra copies, ${r.replaced} replaced, ${r.ignored} ignored`, 'success');
        }} />
      )}
      {resolved && (
        <div className="card">
          <b>Already-owned books handled:</b> {resolved.copies_added} extra copies added, {resolved.replaced} replacement copies, {resolved.ignored} ignored.
        </div>
      )}

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
  const dry = data.dry_run;
  const found = data.conflicts?.length || 0;
  return (
    <div className="card stack">
      <h3>{dry ? 'Preview — nothing has been changed yet' : 'Import finished'}</h3>
      <div className="stat-row compact">
        <div className="stat"><b>{data.total}</b><span>rows</span></div>
        <div className="stat"><b>{data.created}</b><span>{dry ? 'would be added' : 'added'}</span></div>
        {found > 0 && <div className="stat"><b>{found}</b><span>already in MyLib{dry ? ' — you’ll be asked' : ''}</span></div>}
        {data.copies_added > 0 && <div className="stat"><b>{data.copies_added}</b><span>extra copies</span></div>}
        {(data.updated + data.replaced) > 0 && <div className="stat"><b>{data.updated + data.replaced}</b><span>{dry ? 'would be updated' : 'updated'}</span></div>}
        {data.already_imported > 0 && <div className="stat"><b>{data.already_imported}</b><span>imported before</span></div>}
        {(data.skipped + data.ignored) > 0 && <div className="stat"><b>{data.skipped + data.ignored}</b><span>skipped</span></div>}
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
      {!dry && !found && <Link to="/" className="btn">Go to library</Link>}
    </div>
  );
}

// One row per book that's already in MyLib: replacement (retag) / 2nd copy / ignore.
function ConflictReview({ conflicts, onDone }) {
  const { toast } = useApp();
  const [choices, setChoices] = useState(() => conflicts.map(() => null));
  const [tags, setTags] = useState(() => conflicts.map((c) => tagList(c.existing.tags)));
  const [busy, setBusy] = useState(false);
  const pending = choices.filter((c) => !c).length;

  const choose = (i, action) => setChoices((list) => list.map((c, j) => (j === i ? (c === action ? null : action) : c)));
  const chooseAll = (action) => setChoices(conflicts.map(() => action));

  const finish = async () => {
    setBusy(true);
    try {
      const decisions = conflicts.map((c, i) => ({
        action: choices[i] || 'ignore',
        existing_id: c.existing.id,
        source_id: c.source_id,
        fields: c.fields,
        ...(choices[i] === 'replace' ? { tags: tags[i] } : {}),
      }));
      onDone(await api.post('/api/import/resolve', { decisions }));
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div>
        <h3>{conflicts.length} {conflicts.length === 1 ? 'book is' : 'books are'} already in MyLib</h3>
        <p className="muted small">Choose what to do with each copy from the file. Anything left unanswered is ignored.</p>
      </div>
      <div className="row gap wrap">
        <span className="muted small">All:</span>
        <button className="btn btn-small" onClick={() => chooseAll('replace')}>Replacement copies</button>
        <button className="btn btn-small" onClick={() => chooseAll('copy')}>Add 2nd copies</button>
        <button className="btn btn-small" onClick={() => chooseAll('ignore')}>Ignore all</button>
      </div>
      <ul className="conflicts">
        {conflicts.map((c, i) => (
          <li key={`${c.row}-${c.existing.id}`} className="conflict">
            <Cover src={c.existing.cover} title={c.existing.title} size="sm" />
            <div className="result-info">
              <strong>{c.fields.title}</strong>
              {c.fields.creators && <span>{c.fields.creators}</span>}
              <span className="muted small">
                Row {c.row} · already in {c.existing.collection_name}{c.existing.copies > 1 ? ` (×${c.existing.copies})` : ''}
              </span>
              <div className="duplicate-actions">
                {[['replace', 'Replacement copy — retag it'], ['copy', 'Add 2nd copy'], ['ignore', 'Ignore']].map(([a, label]) => (
                  <button key={a} className={`btn btn-small choice ${choices[i] === a ? 'on' : ''}`} aria-pressed={choices[i] === a}
                    onClick={() => choose(i, a)}>
                    {choices[i] === a && <Icon name="check" size={14} />} {label}
                  </button>
                ))}
              </div>
              {choices[i] === 'replace' && (
                <div className="conflict-tags">
                  <span className="muted small">Tags for this copy:</span>
                  <TagPicker value={tags[i]} onChange={(list) => setTags((all) => all.map((t, j) => (j === i ? list : t)))} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="row-end">
        {pending > 0 && <span className="muted small">{pending} not answered yet (will be ignored)</span>}
        <button className="btn btn-primary" onClick={finish} disabled={busy}>{busy ? 'Saving…' : 'Done'}</button>
      </div>
    </div>
  );
}
