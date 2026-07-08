import { useState } from 'react';

const CHANGELOG = [
  { version: '0.4.0', notes: 'Added changeable profile pictures and a new dark red theme.' },
  { version: '0.3.0', notes: 'Switched to a friends-list layout with 1:1 chat instead of servers/channels.' },
  { version: '0.2.0', notes: 'Added real-time typing indicators and online presence.' },
  { version: '0.1.0', notes: 'Initial release: register/login, real-time messaging.' },
];

export default function TopBar({ requests, onRefreshRequests, onRespond, onSendRequest }) {
  const [showExtra, setShowExtra] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');

  async function handleAddFriend(e) {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    try {
      await onSendRequest(addUsername.trim());
      setAddSuccess(`Friend request sent to ${addUsername.trim()}`);
      setAddUsername('');
    } catch (err) {
      setAddError(err.message);
    }
  }

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="app-brand">MK</span>
        <div className="dropdown-wrap">
          <button className="top-bar-btn" onClick={() => setShowExtra((v) => !v)}>Extra ▾</button>
          {showExtra && (
            <div className="dropdown-menu" onMouseLeave={() => setShowExtra(false)}>
              <div className="dropdown-item disabled">Nothing here yet</div>
            </div>
          )}
        </div>
      </div>
      <div className="top-bar-right">
        <button className="top-bar-btn" onClick={() => setShowLog(true)}>Update Log</button>
        <button
          className="top-bar-btn"
          onClick={() => {
            onRefreshRequests();
            setShowRequests(true);
          }}
        >
          Friend Request{requests.length > 0 && <span className="badge">{requests.length}</span>}
        </button>
      </div>

      {showLog && (
        <div className="modal-overlay" onClick={() => setShowLog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Update Log</h2>
            {CHANGELOG.map((entry) => (
              <div key={entry.version} className="changelog-entry">
                <div className="changelog-version">v{entry.version}</div>
                <div className="changelog-notes">{entry.notes}</div>
              </div>
            ))}
            <div className="modal-actions">
              <button onClick={() => setShowLog(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showRequests && (
        <div className="modal-overlay" onClick={() => setShowRequests(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add a friend</h2>
            <form onSubmit={handleAddFriend}>
              <input
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                placeholder="Enter a username"
                autoFocus
              />
              {addError && <div className="auth-error">{addError}</div>}
              {addSuccess && <div className="add-success">{addSuccess}</div>}
              <div className="modal-actions">
                <button type="submit">Send Friend Request</button>
              </div>
            </form>

            <h2 style={{ marginTop: 24 }}>Pending Requests</h2>
            {requests.length === 0 && <div className="friends-empty">No pending requests.</div>}
            {requests.map((r) => (
              <div key={r.id} className="request-row">
                <span>{r.fromUsername}</span>
                <div className="request-actions">
                  <button onClick={() => onRespond(r.id, true)}>Accept</button>
                  <button className="secondary" onClick={() => onRespond(r.id, false)}>Decline</button>
                </div>
              </div>
            ))}

            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowRequests(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
