import { useEffect, useState } from 'react';

// Operator tool: lists every account, lets an admin grant/revoke tiers or
// admin status, or remove an account entirely. Gated server-side on every
// request (see requireAdmin in server/auth.js) -- this component being
// reachable in the UI doesn't itself grant any access.
export default function AdminPanel({ currentUser, onListUsers, onSetTier, onSetAdmin, onDeleteUser, onClose }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    onListUsers()
      .then((rows) => { if (!cancelled) setUsers(rows); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load users'); });
    return () => { cancelled = true; };
  }, []);

  async function toggleTier(user, tier) {
    setBusyId(user.id);
    setError('');
    try {
      const key = tier === 'plus' ? 'isPlus' : tier === 'premium' ? 'isPremium' : 'isUltra';
      const nextValue = !user[key];
      await onSetTier(user.id, tier, nextValue);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, [key]: nextValue } : u)));
    } catch (err) {
      setError(err.message || 'Failed to update tier');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleAdmin(user) {
    if (user.id === currentUser.id) return;
    setBusyId(user.id);
    setError('');
    try {
      const nextValue = !user.isAdmin;
      await onSetAdmin(user.id, nextValue);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, isAdmin: nextValue } : u)));
    } catch (err) {
      setError(err.message || 'Failed to update admin status');
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(user) {
    if (user.id === currentUser.id) return;
    if (!window.confirm(`Permanently delete ${user.username}'s account and all their messages? This can't be undone.`)) return;
    setBusyId(user.id);
    setError('');
    try {
      await onDeleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal admin-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Admin Panel</h2>
        {error && <div className="form-error">{error}</div>}
        {!users ? (
          <div className="admin-panel-loading">Loading users…</div>
        ) : (
          <div className="admin-user-list">
            {users.map((u) => (
              <div key={u.id} className="admin-user-row">
                <div className="admin-user-identity">
                  <span className="admin-user-name">{u.displayName || u.username}</span>
                  <span className="admin-user-handle">@{u.username}</span>
                </div>
                <div className="admin-user-actions">
                  <button
                    type="button"
                    className={`admin-tier-btn ${u.isPlus ? 'active' : ''}`}
                    disabled={busyId === u.id}
                    onClick={() => toggleTier(u, 'plus')}
                  >
                    PLUS
                  </button>
                  <button
                    type="button"
                    className={`admin-tier-btn ${u.isPremium ? 'active' : ''}`}
                    disabled={busyId === u.id}
                    onClick={() => toggleTier(u, 'premium')}
                  >
                    PREMIUM
                  </button>
                  <button
                    type="button"
                    className={`admin-tier-btn ${u.isUltra ? 'active' : ''}`}
                    disabled={busyId === u.id}
                    onClick={() => toggleTier(u, 'ultra')}
                  >
                    ULTRA
                  </button>
                  <button
                    type="button"
                    className={`admin-tier-btn ${u.isAdmin ? 'active' : ''}`}
                    disabled={busyId === u.id || u.id === currentUser.id}
                    title={u.id === currentUser.id ? "You can't change your own admin status" : undefined}
                    onClick={() => toggleAdmin(u)}
                  >
                    ADMIN
                  </button>
                  <button
                    type="button"
                    className="admin-delete-btn"
                    disabled={busyId === u.id || u.id === currentUser.id}
                    title={u.id === currentUser.id ? "You can't delete your own account from here" : 'Delete this account'}
                    onClick={() => removeUser(u)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
