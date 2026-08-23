import { useState } from 'react';
import Avatar from './Avatar.jsx';

// Discord Stage / Twitter Spaces style: anyone can listen to a live
// broadcast freely, but becoming a co-speaker (your mic joins the mesh)
// needs the host's approval. Only the host (an admin) can start one.
export default function PodcastView({ session, role, pendingRequest, incomingRequests, isAdmin, currentUser, onStart, onEnd, onStartListening, onStopListening, onRequestJoin, onLeaveStage, onAcceptRequest, onDeclineRequest }) {
  const [title, setTitle] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const isHost = session.hostId === currentUser?.id;
  const iAmSpeaking = session.speakers.some((s) => s.id === currentUser?.id);

  async function handleStart(e) {
    e.preventDefault();
    setStarting(true);
    setError('');
    try {
      await onStart(title.trim() || null);
      setTitle('');
    } catch (err) {
      setError(err.message || 'Could not start the podcast.');
    } finally {
      setStarting(false);
    }
  }

  if (!session.isLive) {
    return (
      <div className="podcast-view podcast-view-empty">
        <div className="podcast-empty-icon">🎙️</div>
        <h2>No podcast is live</h2>
        {isAdmin ? (
          <form className="podcast-start-form" onSubmit={handleStart}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give it a title (optional)"
              maxLength={100}
            />
            {error && <div className="form-error">{error}</div>}
            <button type="submit" disabled={starting}>{starting ? 'Going live…' : 'Go Live'}</button>
          </form>
        ) : (
          <p className="podcast-empty-hint">Check back later, or ask a host to start one.</p>
        )}
      </div>
    );
  }

  return (
    <div className="podcast-view">
      <div className="podcast-header">
        <span className="podcast-live-pill"><span className="podcast-live-dot" /> LIVE</span>
        <div className="podcast-title">{session.title || 'Untitled Podcast'}</div>
        <div className="podcast-host">
          Hosted by {session.hostDisplayName || session.hostUsername}
        </div>
      </div>

      <div className="podcast-speakers">
        <div className="podcast-section-label">Speakers ({session.speakers.length})</div>
        <div className="podcast-speakers-grid">
          {session.speakers.map((s) => (
            <div key={s.id} className="podcast-speaker-card">
              <Avatar username={s.username} avatarColor={s.avatarColor} avatarIcon={s.avatarIcon} avatarUrl={s.avatarUrl} size={56} />
              <div className="podcast-speaker-name">{s.displayName || s.username}</div>
              {s.id === session.hostId && <div className="podcast-host-badge">Host</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="podcast-controls">
        {isHost ? (
          <button className="danger" onClick={onEnd}>End Podcast</button>
        ) : iAmSpeaking ? (
          <button className="secondary" onClick={onLeaveStage}>Leave Stage</button>
        ) : (
          <>
            {role === 'none' && <button onClick={onStartListening}>Listen</button>}
            {role === 'listening' && <button className="secondary" onClick={onStopListening}>Stop Listening</button>}
            {pendingRequest ? (
              <button className="secondary" disabled>Request pending…</button>
            ) : (
              <button className="secondary" onClick={onRequestJoin}>Request to Speak</button>
            )}
          </>
        )}
      </div>

      {isHost && incomingRequests.length > 0 && (
        <div className="podcast-requests">
          <div className="podcast-section-label">Requests to speak</div>
          {incomingRequests.map((r) => (
            <div key={r.id} className="podcast-request-row">
              <Avatar username={r.username} avatarColor={r.avatarColor} avatarIcon={r.avatarIcon} avatarUrl={r.avatarUrl} size={36} />
              <div className="podcast-request-name">{r.displayName || r.username}</div>
              <div className="podcast-request-actions">
                <button onClick={() => onAcceptRequest(r.id)}>Accept</button>
                <button className="secondary" onClick={() => onDeclineRequest(r.id)}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
