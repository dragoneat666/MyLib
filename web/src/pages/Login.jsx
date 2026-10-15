import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ setup, onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (setup && password !== confirm) return setError("Passwords don't match");
    setBusy(true);
    try {
      await api.post(setup ? '/api/auth/setup' : '/api/auth/login', { username, password });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <img src="/favicon.svg" alt="" width="56" height="56" />
        <h1>MyLib</h1>
        {setup ? (
          <p className="muted">Welcome! Create the first account. It will be the admin — you can add more people later in Settings.</p>
        ) : (
          <p className="muted">Sign in to your library</p>
        )}
        <label className="field">
          <span>Username</span>
          <input autoFocus autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={setup ? 6 : undefined} />
        </label>
        {setup && (
          <label className="field">
            <span>Confirm password</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>{setup ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
  );
}
