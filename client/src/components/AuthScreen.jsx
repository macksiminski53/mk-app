import { useState } from 'react';
import { api } from '../api.js';

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'token'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accountToken, setAccountToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'token') {
        const data = await api.loginWithToken(accountToken.trim());
        onAuthed(data.token, data.user);
        return;
      }
      const fn = mode === 'login' ? api.login : api.register;
      const data = await fn(username.trim(), password);
      onAuthed(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>MK</h1>
        <p className="auth-sub">
          {mode === 'login' && "We're so excited to see you again!"}
          {mode === 'register' && 'Join the conversation.'}
          {mode === 'token' && 'Log in on this device using your account token.'}
        </p>

        {mode === 'token' ? (
          <>
            <label>Account Token</label>
            <input
              value={accountToken}
              onChange={(e) => setAccountToken(e.target.value)}
              placeholder="e.g. hwj283HBWJIDIUO8923KS"
              autoFocus
              required
            />
          </>
        ) : (
          <>
            <label>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoFocus
              required
            />

            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              required
            />
          </>
        )}

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" disabled={loading}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Log In' : mode === 'register' ? 'Register' : 'Log In with Token'}
        </button>

        <div className="auth-switch">
          {mode === 'login' && (
            <span>
              Need an account? <a onClick={() => setMode('register')}>Register</a>
              {' · '}
              <a onClick={() => setMode('token')}>Log in with account token</a>
            </span>
          )}
          {mode === 'register' && (
            <span>
              Already have an account? <a onClick={() => setMode('login')}>Log In</a>
            </span>
          )}
          {mode === 'token' && (
            <span>
              <a onClick={() => setMode('login')}>Back to username/password login</a>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
