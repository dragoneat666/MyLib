// Backups.jsx — nightly backup files, run one now, restore.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatBytes } from '../api.js';
import { useApp } from '../context.jsx';
import { Icon } from '../components/ui.jsx';

export default function Backups() {
  const { user, toast } = useApp();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => api.get('/api/backups').then(setData).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/backups/run');
      toast(`Saved ${r.sql} and ${r.csv}`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  const restore = async (file) => {
    if (!file) return;
    if (!confirm(`Replace the ENTIRE library with “${file.name}”?\n\nA copy of the current database is saved first. Everyone will need to sign in again.`)) {
      fileRef.current.value = '';
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post('/api/backups/restore', fd);
      alert('Restore complete. Please sign in again.');
      window.location.href = '/';
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
    fileRef.current.value = '';
  };

  return (
    <div className="page narrow">
      <h1>Backups</h1>
      <p className="muted">
        Every night MyLib writes a full SQL dump and a CSV of the whole library to the backup folder
        {data ? <> (<code>{data.dir}</code>, schedule <code>{data.schedule}</code>, kept {data.keepDays} days)</> : ''}.
        Map that folder to your computer in Docker and your copy-to-Dropbox script can pick the files up.
      </p>

      {user.is_admin && (
        <div className="card row gap wrap">
          <button className="btn btn-primary" onClick={runNow} disabled={busy}><Icon name="backup" size={18} /> Back up now</button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={18} /> Restore from .sql…</button>
          <input ref={fileRef} type="file" accept=".sql" hidden onChange={(e) => restore(e.target.files[0])} />
        </div>
      )}

      <div className="card">
        {data?.backups?.length ? (
          <table className="simple-table">
            <thead><tr><th>File</th><th>Size</th><th className="hide-sm">Saved</th><th /></tr></thead>
            <tbody>
              {data.backups.map((b) => (
                <tr key={b.file}>
                  <td><code>{b.file}</code></td>
                  <td>{formatBytes(b.size)}</td>
                  <td className="hide-sm">{new Date(b.modified).toLocaleString()}</td>
                  <td><a className="icon-btn" href={`/api/backups/download/${encodeURIComponent(b.file)}`} aria-label={`Download ${b.file}`}><Icon name="download" size={18} /></a></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No backups yet{user.is_admin ? ' — press “Back up now” to make the first one.' : '.'}</p>
        )}
      </div>
    </div>
  );
}
