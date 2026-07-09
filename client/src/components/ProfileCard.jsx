import Avatar from './Avatar.jsx';

// Splits a "Song - Artist" style status into parts for the Playing card.
// Falls back to treating the whole thing as a single line if it doesn't
// match that shape.
function parsePlaying(statusText) {
  if (!statusText) return null;
  const sepIdx = statusText.indexOf(' - ');
  if (sepIdx === -1) return { title: statusText, artist: null };
  return {
    title: statusText.slice(0, sepIdx),
    artist: statusText.slice(sepIdx + 3),
  };
}

export default function ProfileCard({ user, onClose, onEditProfile, onLogout }) {
  const playing = parsePlaying(user.statusText);

  return (
    <div className="profile-card-backdrop" onClick={onClose}>
      <div className="profile-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-card-close" onClick={onClose} title="Close">✕</button>

        <div className="profile-card-banner" />

        <div className="profile-card-body">
          <div className="profile-card-avatar-wrap">
            <Avatar username={user.username} avatarColor={user.avatarColor} avatarUrl={user.avatarUrl} size={72} className="profile-card-avatar" />
            <span className="profile-card-status-dot" />
          </div>

          <div className="profile-card-name">{user.username}</div>
          <div className="profile-card-sub">MK Member</div>

          {playing && (
            <div className="profile-card-playing">
              <div className="profile-card-playing-label">Playing</div>
              <div className="profile-card-playing-row">
                <div className="profile-card-playing-icon">♫</div>
                <div className="profile-card-playing-info">
                  <div className="profile-card-playing-title">{playing.title}</div>
                  {playing.artist && <div className="profile-card-playing-artist">{playing.artist}</div>}
                </div>
              </div>
            </div>
          )}

          {!playing && (
            <div className="profile-card-noplay">Connect MusicToDiscord to show your song playing on Apple Music!</div>
          )}

          <button className="profile-card-edit-btn" onClick={onEditProfile}>✎ Edit Profile</button>

          <div className="profile-card-row">
            <span className="profile-card-row-dot" />
            <span>Online</span>
          </div>

          <div className="profile-card-row profile-card-row-clickable" onClick={onLogout}>
            <span>⏻ Log Out</span>
          </div>
        </div>
      </div>
    </div>
  );
}
