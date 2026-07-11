import { useEffect, useRef, useState } from 'react';

// The vertical strip of Mega Chat icons down the left edge, Discord-style.
// "Home" always goes back to the regular friends/DM view; each server is a
// colored circle with its initial; "+" opens the create-a-Mega-Chat modal.
export default function ServerRail({ servers, activeServerId, onSelectHome, onSelectServer, isUltra, onCreate, createTrigger }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const prevCreateTriggerRef = useRef(createTrigger);

  // Lets the top bar's Extra menu open this same modal without needing to
  // lift showCreate's state all the way up -- same "bump a counter, watch
  // it change" pattern ChatArea uses for openSettingsTrigger.
  useEffect(() => {
    if (createTrigger !== undefined && createTrigger !== prevCreateTriggerRef.current) {
      prevCreateTriggerRef.current = createTrigger;
      setShowCreate(true);
    }
  }, [createTrigger]);

  const price = isUltra ? '50¢' : '$1';

  async function handleCreate(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setCreating(true);
    setError('');
    try {
      await onCreate(clean);
      setShowCreate(false);
      setName('');
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="server-rail">
      <div
        className={`server-rail-icon server-rail-home ${activeServerId === null ? 'active' : ''}`}
        onClick={onSelectHome}
        title="Friends"
      >
        MK
      </div>

      {servers.length > 0 && <div className="server-rail-divider" />}

      {servers.map((s) => (
        <div
          key={s.id}
          className={`server-rail-icon ${activeServerId === s.id ? 'active' : ''}`}
          style={{ background: s.iconColor }}
          onClick={() => onSelectServer(s.id)}
          title={s.name}
        >
          {s.name.slice(0, 1).toUpperCase()}
        </div>
      ))}

      <div className="server-rail-icon server-rail-add" onClick={() => setShowCreate(true)} title="Create a Mega Chat">
        +
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => !creating && setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create a Mega Chat</h2>
            <p className="server-rail-create-hint">
              A Mega Chat is a server with unlimited members and its own text channels. Costs {price}
              {isUltra ? ' (MK ULTRA price)' : ''}, one time, via Stripe.
            </p>
            <form onSubmit={handleCreate}>
              <div className="settings-section">
                <div className="settings-label">Server name</div>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Mega Chat"
                  maxLength={60}
                />
              </div>
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
                <button type="submit" disabled={creating || !name.trim()}>{creating ? 'Starting checkout…' : `Create for ${price}`}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
