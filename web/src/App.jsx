import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Library from './pages/Library.jsx';
import AddBook from './pages/AddBook.jsx';
import ImportPage from './pages/Import.jsx';
import ExportPage from './pages/Export.jsx';
import Backups from './pages/Backups.jsx';
import Settings from './pages/Settings.jsx';

// No logins: MyLib is only reachable on the home network / NetBird.
export default function App() {
  return (
    <AppProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/collections/:id" element={<Library />} />
          <Route path="/unsorted" element={<Library unsortedView key="unsorted" />} />
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
