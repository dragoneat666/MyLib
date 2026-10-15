// Settings.jsx — account, signed-in devices, people, data sources, Android app.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Icon } from '../components/ui.jsx';

export default function Settings() {
  const { user, toast } = useApp();
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api.get('/api/info').then(setInfo).catch(() => {});
  }, []);

  return (
    <div className="page narrow">
      <h1>Settings</h1>

      <section className="card stack">
        <h2>Android app</h2>
        <p>
          The phone app shows this same library and adds a camera mode: point it at a barcode or a cover and it finds the book.
        </p>
        <ol className="steps">
          <li>On the phone, open <b>{window.location.origin}/download/mylib.apk</b> (or tap the button below) and install it.
            Android will ask to allow installing apps from your browser.</li>
          <li>Open MyLib and enter the server address — the same address you use in the browser, e.g. your NetBird IP
            and port like <code>http://100.x.y.z:14100</code>.</li>
          <li>Sign in with your MyLib username and password.</li>
        </ol>
        {info?.apk ? (
          <a className="btn btn-primary" href="/download/mylib.apk"><Icon name="download" size={18} /> Download the Android app</a>
        ) : (
          <p className="muted small">This server build doesn't include the APK — download it from the GitHub release instead.</p>
        )}
      </section>

      {!info?.authDisabled && <Account toast={toast} />}
      {!info?.authDisabled && <Sessions toast={toast} />}
      {user.is_admin && !info?.authDisabled && <People toast={toast} me={user} />}

      <section className="card stack">
        <h2>Book information sources</h2>
        <ul className="sources">
          <li><Dot on /> <b>Open Library</b> — free, always on</li>
          <li><Dot on={info?.providers?.google} /> <b>Google Books</b> — {info?.providers?.google ? 'on' : <>off. Add a free <code>GOOGLE_BOOKS_API_KEY</code> for better titles and descriptions.</>}</li>
          <li><Dot on={info?.providers?.isbndb} /> <b>ISBNdb</b> — {info?.providers?.isbndb ? 'on' : <>off (paid, <code>ISBNDB_API_KEY</code>)</>}</li>
          <li><Dot on={info?.providers?.ai} /> <b>Claude cover reading</b> — {info?.providers?.ai ? 'on: cover photos are identified by AI' : <>off. With <code>ANTHROPIC_API_KEY</code>, cover photos are read by AI for much better matches.</>}</li>
        </ul>
      </section>

      <p className="muted small center">MyLib {info?.version}</p>
    </div>
  );
}

const Dot = ({ on }) => <span className={`dot ${on ? 'on' : ''}`} aria-hidden="true" />;

function Account({ toast }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/auth/password', { current, password });
      toast('Password changed', 'success');
      setCurrent('');
      setPassword('');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <section className="card stack">
      <h2>Change password</h2>
      <form className="field-grid" onSubmit={submit}>
        <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></label>
        <div className="field wide row-end"><button className="btn btn-primary">Change password</button></div>
      </form>
    </section>
  );
}

function Sessions({ toast }) {
  const [list, setList] = useState([]);
  const load = useCallback(() => api.get('/api/auth/sessions').then((d) => setList(d.sessions)).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  const revoke = async (s) => {
    if (!confirm(`Sign out “${s.name}”?`)) return;
    await api.del(`/api/auth/sessions/${s.id}`).catch((e) => toast(e.message, 'error'));
    load();
  };
  return (
    <section className="card stack">
      <h2>Signed-in browsers & phones</h2>
      <table className="simple-table">
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>
                <div className="truncate">{s.kind === 'device' ? '📱 ' : ''}{s.name || 'Unknown'}</div>
                <div className="muted small">signed in {s.created_at?.slice(0, 10)}{s.last_used_at ? ` · last used ${s.last_used_at.slice(0, 10)}` : ''}</div>
              </td>
              <td className="right">{s.current ? <span className="chip">this one</span> : <button className="btn btn-small" onClick={() => revoke(s)}>Sign out</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function People({ toast, me }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', is_admin: false });
  const load = useCallback(() => api.get('/api/users').then((d) => setUsers(d.users)).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/users', form);
      toast(`Added ${form.username}`, 'success');
      setForm({ username: '', password: '', is_admin: false });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const resetPassword = async (u) => {
    const password = prompt(`New password for ${u.username} (at least 6 characters):`);
    if (!password) return;
    try {
      await api.put(`/api/users/${u.id}`, { password });
      toast('Password updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async (u) => {
    if (!confirm(`Remove ${u.username}? Their books stay in the library.`)) return;
    try {
      await api.del(`/api/users/${u.id}`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <section className="card stack">
      <h2>People</h2>
      <p className="muted small">Everyone shares the same library. Admins can also restore backups and manage people.</p>
      <table className="simple-table">
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td><b>{u.username}</b> {u.is_admin && <span className="chip">admin</span>}</td>
              <td className="right">
                <button className="btn btn-small" onClick={() => resetPassword(u)}>Set password</button>{' '}
                {u.id !== me.id && <button className="btn btn-small danger" onClick={() => remove(u)}>Remove</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="field-grid" onSubmit={add}>
        <label className="field"><span>Username</span><input value={form.username} autoCapitalize="none" onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required /></label>
        <label className="radio"><input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} /> <span>Admin</span></label>
        <div className="field row-end"><button className="btn btn-primary"><Icon name="plus" size={18} /> Add person</button></div>
      </form>
    </section>
  );
}
