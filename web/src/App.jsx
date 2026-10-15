import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api.js';
import { AppProvider } from './context.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Library from './pages/Library.jsx';
import AddBook from './pages/AddBook.jsx';
import ImportPage from './pages/Import.jsx';
import ExportPage from './pages/Export.jsx';
import Backups from './pages/Backups.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const [auth, setAuth] = useState(null); // null = loading

  const loadStatus = useCallback(async () => {
    try {
      setAuth(await api.get('/api/auth/status'));
    } catch {
      setAuth({ error: true });
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const onLoggedOut = () => loadStatus();
    window.addEventListener('mylib:logged-out', onLoggedOut);
    return () => window.removeEventListener('mylib:logged-out', onLoggedOut);
  }, [loadStatus]);

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    window.MyLibAndroid?.loggedOut?.();
    loadStatus();
  };

  if (!auth) return <div className="splash">Loading…</div>;
  if (auth.error) {
    return (
      <div className="splash">
        <p>Can't reach the MyLib server.</p>
        <button className="btn" onClick={loadStatus}>Try again</button>
      </div>
    );
  }
  if (!auth.user) {
    // Inside the Android app, signing in happens on the app's own screen.
    if (!auth.setupRequired && window.MyLibAndroid?.loggedOut) {
      window.MyLibAndroid.loggedOut();
      return <div className="splash">Signing out…</div>;
    }
    return <Login setup={auth.setupRequired} onDone={loadStatus} />;
  }

  return (
    <AppProvider user={auth.user} onLogout={auth.authDisabled ? null : logout}>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/collections/:id" element={<Library />} />
          <Route path="/add" element={<AddBook />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/backups" element={<Backups />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AppProvider>
  );
}
