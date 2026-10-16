// context.jsx — app-wide state: collections, New & Unsorted, the tag list and toasts.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// Books with no collection yet. id 0 stands for it in pickers and URLs use "unsorted".
export const UNSORTED = { id: 0, name: 'New & Unsorted' };

export function AppProvider({ children }) {
  const [collections, setCollections] = useState([]);
  const [unsorted, setUnsorted] = useState({ item_count: 0, copy_count: 0, covers: [] });
  const [tags, setTags] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [version, setVersion] = useState(0); // bump to make pages reload their items
  const nextId = useRef(1);

  const refreshCollections = useCallback(async () => {
    try {
      const data = await api.get('/api/collections');
      setCollections(data.collections);
      if (data.unsorted) setUnsorted(data.unsorted);
    } catch {
      // shown elsewhere
    }
  }, []);

  const refreshTags = useCallback(async () => {
    try {
      setTags((await api.get('/api/tags')).tags);
    } catch {
      // shown elsewhere
    }
  }, []);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // toast('Saved', 'success', { action: { label: 'Add tag', onClick } })
  const toast = useCallback((message, kind = 'info', { action } = {}) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, kind, action }]);
    setTimeout(() => dismiss(id), action ? 8000 : kind === 'error' ? 6000 : 3500);
  }, [dismiss]);

  const libraryChanged = useCallback(() => {
    setVersion((v) => v + 1);
    refreshCollections();
    refreshTags();
  }, [refreshCollections, refreshTags]);

  useEffect(() => {
    refreshCollections();
    refreshTags();
  }, [refreshCollections, refreshTags]);

  // The Android app calls this after its camera scanner adds books.
  useEffect(() => {
    window.mylibRefresh = libraryChanged;
    return () => {
      delete window.mylibRefresh;
    };
  }, [libraryChanged]);

  return (
    <AppContext.Provider
      value={{ collections, unsorted, tags, refreshCollections, refreshTags, toast, version, libraryChanged }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind} ${t.action ? 'has-action' : ''}`}>
            <span>{t.message}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { dismiss(t.id); t.action.onClick(); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
