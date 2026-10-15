// ui.jsx — small shared pieces: icons, modal, cover image, collection picker.

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context.jsx';

const PATHS = {
  menu: 'M3 6h18M3 12h18M3 18h18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  books: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-.8 3 15.5-3.5.8z',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  backup: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  close: 'M6 6l12 12M18 6L6 18',
  camera: 'M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  check: 'M5 12l5 5L20 7',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
};

export function Icon({ name, size = 20, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide = false, footer = null }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// Book cover with a generated "spine" placeholder when there's no image.
const PALETTE = ['#2f5d50', '#7a4b3a', '#3d5a80', '#8a6d1f', '#6b4c7a', '#3f6b3a', '#8c3b3b', '#44606b'];
export function Cover({ src, title, size = 'md' }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img className={`cover cover-${size}`} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  let h = 0;
  for (const ch of String(title || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <div className={`cover cover-${size} cover-blank`} style={{ background: PALETTE[h % PALETTE.length] }}>
      <span>{title}</span>
    </div>
  );
}

export function CollectionSelect({ value, onChange, allowNew = true, id }) {
  const { collections } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  if (adding) {
    return (
      <div className="inline-new">
        <input id={id} autoFocus placeholder="New collection name" value={name}
          onChange={(e) => {
            setName(e.target.value);
            onChange({ newName: e.target.value });
          }} />
        <button type="button" className="btn btn-ghost" onClick={() => { setAdding(false); onChange({ id: collections[0]?.id }); }}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <select id={id} value={value ?? ''} onChange={(e) => {
      if (e.target.value === '__new') {
        setAdding(true);
        onChange({ newName: '' });
      } else onChange({ id: Number(e.target.value) });
    }}>
      {!collections.length && <option value="">— no collections yet —</option>}
      {collections.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
      {allowNew && <option value="__new">+ New collection…</option>}
    </select>
  );
}

export function Stars({ value, onChange }) {
  const n = Math.round(Number(value) || 0);
  return (
    <span className="stars" role={onChange ? 'radiogroup' : undefined} aria-label={`Rating ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) =>
        onChange ? (
          <button key={i} type="button" className={`star ${i <= n ? 'on' : ''}`} aria-label={`${i} stars`}
            onClick={() => onChange(i === n ? '' : String(i))}>
            ★
          </button>
        ) : (
          <span key={i} className={`star ${i <= n ? 'on' : ''}`}>★</span>
        )
      )}
    </span>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
