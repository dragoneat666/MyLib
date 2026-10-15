// context.jsx — app-wide state: the logged-in user, the collection list and toasts.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ user, onLogout, children }) {
  const [collections, setCollections] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [version, setVersion] = useState(0); // bump to make pages reload their items
  const nextId = useRef(1);

  const refreshCollections = useCallback(async () => {
    try {
      const data = await api.get('/api/collections');
      setCollections(data.collections);
    } catch {
      // shown elsewhere
    }
  }, []);

  const toast = useCallback((message, kind = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const libraryChanged = useCallback(() => {
    setVersion((v) => v + 1);
    refreshCollections();
  }, [refreshCollections]);

  useEffect(() => {
    refreshCollections();
  }, [refreshCollections]);

  // The Android app calls this after its camera scanner adds books.
  useEffect(() => {
    window.mylibRefresh = libraryChanged;
    return () => {
      delete window.mylibRefresh;
    };
  }, [libraryChanged]);

  return (
    <AppContext.Provider value={{ user, onLogout, collections, refreshCollections, toast, version, libraryChanged }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
