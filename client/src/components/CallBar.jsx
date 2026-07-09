import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Renders whichever call UI is active: an incoming-call ring banner, an
// outgoing "calling..." banner, or a persistent active-call bar with a
// live duration timer and mute/hang-up controls. Renders nothing if
// call.status is null -- App.jsx only mounts this when there's a call.
export default function CallBar({ call, onAccept, onDecline, onCancel, onHangUp, onToggleMute, muted }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (call?.status !== 'active') return;
    setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [call?.status, call?.startedAt]);

  if (!call) return null;

  if (call.status === 'incoming') {
    return (
      <div className="call-bar call-bar-incoming">
        <Avatar username={call.fromUsername} avatarColor={call.fromAvatarColor} avatarUrl={call.fromAvatarUrl} size={36} />
        <div className="call-bar-info">
          <div className="call-bar-name">{call.fromUsername}</div>
          <div className="call-bar-sub">Incoming call…</div>
        </div>
        <div className="call-bar-actions">
          <button className="call-btn call-btn-decline" onClick={onDecline} title="Decline">✕</button>
          <button className="call-btn call-btn-accept" onClick={onAccept} title="Accept">📞</button>
        </div>
      </div>
    );
  }

  if (call.status === 'outgoing') {
    return (
      <div className="call-bar call-bar-outgoing">
        <Avatar username={call.friend.username} avatarColor={call.friend.avatarColor} avatarUrl={call.friend.avatarUrl} size={36} />
        <div className="call-bar-info">
          <div className="call-bar-name">{call.friend.username}</div>
          <div className="call-bar-sub">Calling…</div>
        </div>
        <div className="call-bar-actions">
          <button className="call-btn call-btn-decline" onClick={onCancel} title="Cancel">✕</button>
        </div>
      </div>
    );
  }

  // active
  return (
    <div className="call-bar call-bar-active">
      <Avatar username={call.friend.username} avatarColor={call.friend.avatarColor} avatarUrl={call.friend.avatarUrl} size={36} />
      <div className="call-bar-info">
        <div className="call-bar-name">{call.friend.username}</div>
        <div className="call-bar-sub">{formatDuration(elapsed)}</div>
      </div>
      <div className="call-bar-actions">
        <button className={`call-btn ${muted ? 'call-btn-muted-on' : 'call-btn-muted-off'}`} onClick={onToggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🎙'}
        </button>
        <button className="call-btn call-btn-decline" onClick={onHangUp} title="Hang up">📞</button>
      </div>
    </div>
  );
}
