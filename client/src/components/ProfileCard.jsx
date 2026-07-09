import { useState } from 'react';
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

function formatMemberSince(createdAt) {
  if (!createdAt) return null;
  // Server stores "YYYY-MM-DD HH:MM:SS" (SQLite datetime('now')); Safari/old
  // engines choke on that without a "T", so normalize it first.
  const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

// isOwn=true renders the editable version (bio + status are click-to-edit,
// with Edit Profile / Log Out actions). isOwn=false renders a read-only
// popout for viewing a friend's profile, closer to Discord's user popup.
export default function ProfileCard({ user, isOwn, onClose, onEditProfile, onLogout, onSetBio }) {
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState(user.bio || '');

  const playing = parsePlaying(user.statusText);
  const memberSince = formatMemberSince(user.createdAt);

  async function handleBioSubmit(e) {
    e.preventDefault();
    await onSetBio(bioDraft);
    setEditingBio(false);
  }

  return (
    <div className="profile-card-backdrop" onClick={onClose}>
      <div className="profile-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-card-close" onClick={onClose} title="Close">✕</button>

        <div className="profile-card-banner" />

        <div className="profile-card-body">
          <div className="profile-card-avatar-wrap">
            <Avatar username={user.username} avatarColor={user.avatarColor} avatarUrl={user.avatarUrl} size={72} className="profile-card-avatar" />
            <span className="profile-card-status-dot" style={{ background: isOwn || user.online ? '#3ba55d' : '#747f8d' }} />
          </div>

          <div className="profile-card-name">{user.username}</div>
          <div className="profile-card-sub">MK Member</div>

          <div className="profile-card-divider" />

          {isOwn && editingBio ? (
            <form onSubmit={handleBioSubmit} className="profile-card-bio-form">
              <textarea
                autoFocus
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                onBlur={handleBioSubmit}
                placeholder="Write something about yourself…"
                maxLength={190}
                rows={3}
              />
            </form>
          ) : (
            <div className="profile-card-section">
              <div className="profile-card-section-label">About Me</div>
              {user.bio ? (
                <div
                  className={`profile-card-bio ${isOwn ? 'profile-card-bio-editable' : ''}`}
                  onClick={isOwn ? () => setEditingBio(true) : undefined}
                >
                  {user.bio}
                </div>
              ) : isOwn ? (
                <div className="profile-card-bio profile-card-bio-editable profile-card-bio-empty" onClick={() => setEditingBio(true)}>
                  Click to write a bio…
                </div>
              ) : (
                <div className="profile-card-bio profile-card-bio-empty">No bio yet.</div>
              )}
            </div>
          )}

          <div className="profile-card-section">
            <div className="profile-card-section-label">Playing</div>
            {playing ? (
              <div className="profile-card-playing">
                <div className="profile-card-playing-row">
                  <div className="profile-card-playing-icon">♫</div>
                  <div className="profile-card-playing-info">
                    <div className="profile-card-playing-title">{playing.title}</div>
                    {playing.artist && <div className="profile-card-playing-artist">{playing.artist}</div>}
                  </div>
                </div>
              </div>
            ) : isOwn ? (
              <div className="profile-card-noplay">Connect MusicToDiscord to show your song playing on Apple Music!</div>
            ) : (
              <div className="profile-card-noplay">Not playing anything right now.</div>
            )}
          </div>

          {memberSince && (
            <div className="profile-card-section">
              <div className="profile-card-section-label">Member Since</div>
              <div className="profile-card-membersince">📅 {memberSince}</div>
            </div>
          )}

          {isOwn ? (
            <>
              <button className="profile-card-edit-btn" onClick={onEditProfile}>✎ Edit Status</button>
              <div className="profile-card-row">
                <span className="profile-card-row-dot" />
                <span>Online</span>
              </div>
              <div className="profile-card-row profile-card-row-clickable" onClick={onLogout}>
                <span>⏻ Log Out</span>
              </div>
            </>
          ) : (
            <div className="profile-card-row">
              <span className="profile-card-row-dot" style={{ background: user.online ? '#3ba55d' : '#747f8d' }} />
              <span>{user.online ? 'Online' : 'Offline'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
