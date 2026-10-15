// Export.jsx — download one collection or everything.

import { useApp } from '../context.jsx';
import { Icon } from '../components/ui.jsx';

export default function ExportPage() {
  const { collections } = useApp();
  const total = collections.reduce((n, c) => n + c.item_count, 0);
  return (
    <div className="page narrow">
      <h1>Export</h1>
      <p className="muted">
        CSV files use Libib's column layout (plus series, volume and cover link at the end), so they open in Excel and can be
        imported back into MyLib or Libib.
      </p>

      <div className="card">
        <div className="export-row">
          <div>
            <strong>Entire library</strong>
            <div className="muted small">{total} titles in {collections.length} collections</div>
          </div>
          <a className="btn btn-primary" href="/api/export/csv"><Icon name="download" size={18} /> CSV</a>
          <a className="btn" href="/api/export/sql" title="Full database dump — can be restored on the Backups page">
            <Icon name="download" size={18} /> SQL
          </a>
        </div>
      </div>

      <h2>One collection</h2>
      <div className="card">
        {collections.map((c) => (
          <div className="export-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <div className="muted small">{c.item_count} titles</div>
            </div>
            <a className="btn" href={`/api/export/csv?collection_id=${c.id}`}><Icon name="download" size={18} /> CSV</a>
          </div>
        ))}
        {!collections.length && <p className="muted">No collections yet.</p>}
      </div>
    </div>
  );
}
