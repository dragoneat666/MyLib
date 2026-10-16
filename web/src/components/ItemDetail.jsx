// ItemDetail.jsx — view / edit one book (modal).

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, STATUSES } from '../api.js';
import { useApp, UNSORTED } from '../context.jsx';
import { Cover, Icon, Modal, Stars, TagPicker, tagList } from './ui.jsx';

const FIELD_GROUPS = [
  {
    title: 'Book',
    fields: [
      ['title', 'Title', { wide: true, required: true }],
      ['creators', 'Author(s)', { wide: true, hint: 'Separate several with commas' }],
      ['series', 'Series'],
      ['volume', 'Number in series'],
      ['ean_isbn13', 'ISBN-13'],
      ['upc_isbn10', 'ISBN-10'],
      ['publisher', 'Publisher'],
      ['publish_date', 'Published', { hint: 'YYYY-MM-DD or YYYY' }],
      ['length', 'Pages'],
      ['age_group', 'Age group'],
      ['description', 'Description', { wide: true, textarea: 5 }],
    ],
  },
  {
    title: 'Ours',
    fields: [
      ['status', 'Reading status', { select: STATUSES }],
      ['rating', 'Rating', { stars: true }],
      ['began', 'Began', { type: 'date' }],
      ['completed', 'Completed', { type: 'date' }],
      ['copies', 'Copies', { type: 'number' }],
      ['added', 'Added', { type: 'date' }],
      ['tags', 'Tags', { wide: true, tags: true }],
      ['item_group', 'Group / location', { hint: 'e.g. shelf or room' }],
      ['price', 'Price'],
      ['notes', 'Notes', { wide: true, textarea: 3 }],
      ['review', 'Review', { wide: true, textarea: 3 }],
    ],
  },
];

export default function ItemDetail({ id, onClose, startEditing = false }) {
  const { collections, toast, libraryChanged } = useApp();
  const [item, setItem] = useState(null);
  const [editing, setEditing] = useState(startEditing);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // Only reload when the id changes — parents re-render often and pass a new onClose each time.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    api.get(`/api/items/${id}`).then((it) => {
      setItem(it);
      setForm(it);
    }).catch((err) => {
      toast(err.message, 'error');
      closeRef.current();
    });
  }, [id, toast]);

  if (!item) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const body = {};
      for (const g of FIELD_GROUPS) for (const [k] of g.fields) body[k] = form[k] ?? '';
      body.collection_id = form.collection_id ?? 0;
      const updated = await api.put(`/api/items/${id}`, body);
      setItem(updated);
      setForm(updated);
      setEditing(false);
      libraryChanged();
      toast('Saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!confirm(`Delete “${item.title}” from your library?`)) return;
    await api.del(`/api/items/${id}`);
    libraryChanged();
    toast('Deleted');
    onClose();
  };

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/items/${id}/refresh`, { overwrite: false });
      setItem(r.item);
      setForm(r.item);
      libraryChanged();
      toast(r.changed.length ? `Filled in: ${r.changed.join(', ')}` : 'Nothing new found', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  const uploadCover = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('cover', file);
    setBusy(true);
    try {
      const it = await api.post(`/api/items/${id}/cover`, fd);
      setItem(it);
      libraryChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  const findCover = async () => {
    setBusy(true);
    try {
      const it = await api.post(`/api/items/${id}/cover`, {});
      setItem(it);
      libraryChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  const footer = editing ? (
    <>
      <button className="btn btn-ghost" onClick={() => { setForm(item); setEditing(false); }}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy}>Save</button>
    </>
  ) : (
    <>
      <button className="btn btn-ghost danger" onClick={remove}><Icon name="trash" size={18} /> Delete</button>
      <span className="spacer" />
      {(item.ean_isbn13 || item.upc_isbn10) && (
        <button className="btn btn-ghost" onClick={refresh} disabled={busy} title="Fill in missing details from online sources">
          <Icon name="refresh" size={18} /> Fill in details
        </button>
      )}
      <button className="btn btn-primary" onClick={() => setEditing(true)}><Icon name="edit" size={18} /> Edit</button>
    </>
  );

  return (
    <Modal title={editing ? 'Edit book' : item.collection_name} onClose={onClose} wide footer={footer}>
      <div className="detail">
        <div className="detail-cover">
          <Cover src={item.cover} title={item.title} size="lg" />
          <div className="cover-actions">
            <button className="btn btn-small" onClick={() => fileRef.current?.click()} disabled={busy}>Upload cover</button>
            {!item.cover && (item.ean_isbn13 || item.cover_url) && (
              <button className="btn btn-small" onClick={findCover} disabled={busy}>Find cover</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => uploadCover(e.target.files[0])} />
          </div>
        </div>

        {editing ? (
          <form className="detail-form" onSubmit={save}>
            <label className="field">
              <span>Collection</span>
              <select value={form.collection_id ?? 0} onChange={(e) => set('collection_id', Number(e.target.value) || null)}>
                <option value={0}>{UNSORTED.name}</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {FIELD_GROUPS.map((g) => (
              <fieldset key={g.title} className="field-grid">
                <legend>{g.title}</legend>
                {g.fields.map(([k, label, o = {}]) => (
                  <Field key={k} as={o.tags ? 'div' : 'label'} className={`field ${o.wide ? 'wide' : ''}`}>
                    <span>{label}</span>
                    {o.tags ? (
                      <TagPicker value={tagList(form[k])} onChange={(list) => set(k, list.join(', '))} />
                    ) : o.textarea ? (
                      <textarea rows={o.textarea} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
                    ) : o.select ? (
                      <select value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
                        <option value="">—</option>
                        {o.select.map((s) => <option key={s}>{s}</option>)}
                        {form[k] && !o.select.includes(form[k]) && <option>{form[k]}</option>}
                      </select>
                    ) : o.stars ? (
                      <Stars value={form[k]} onChange={(v) => set(k, v)} />
                    ) : (
                      <input type={o.type || 'text'} required={o.required} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)}
                        min={o.type === 'number' ? 0 : undefined} />
                    )}
                    {o.hint && <small className="muted">{o.hint}</small>}
                  </Field>
                ))}
              </fieldset>
            ))}
          </form>
        ) : (
          <div className="detail-info">
            <h2 className="detail-title">{item.title}</h2>
            {item.creators && <p className="detail-author">by {item.creators}</p>}
            {item.series && <p className="muted">{item.series}{item.volume ? ` #${item.volume}` : ''}</p>}
            <div className="chips">
              {item.status && <span className="chip">{item.status}</span>}
              {item.copies > 1 && <span className="chip">{item.copies} copies</span>}
              {item.copies === 0 && <span className="chip chip-warn">0 copies</span>}
              {tagList(item.tags).map((t) => (
                <Link key={t} to={`/library?tag=${encodeURIComponent(t)}`} className="chip chip-tag" onClick={onClose}>{t}</Link>
              ))}
            </div>
            {Number(item.rating) > 0 && <Stars value={item.rating} />}
            {item.description && <p className="detail-desc">{item.description}</p>}
            <dl className="facts">
              {[
                ['Publisher', item.publisher],
                ['Published', item.publish_date],
                ['Pages', item.length],
                ['ISBN-13', item.ean_isbn13],
                ['ISBN-10', item.upc_isbn10],
                ['Age group', item.age_group],
                ['Group / location', item.item_group],
                ['Began', item.began],
                ['Completed', item.completed],
                ['Price', item.price],
                ['Added', item.added],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            {item.notes && (<><h4>Notes</h4><p className="pre">{item.notes}</p></>)}
            {item.review && (<><h4>Review</h4><p className="pre">{item.review}</p></>)}
          </div>
        )}
      </div>
    </Modal>
  );
}

// A form field wrapper: <label> normally, <div> when it holds buttons (the tag picker).
function Field({ as: Tag = 'label', children, ...rest }) {
  return <Tag {...rest}>{children}</Tag>;
}
