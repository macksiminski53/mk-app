import { useEffect, useRef, useState } from 'react';
import { resolveAvatarUrl } from '../api.js';
import Avatar from './Avatar.jsx';
import { api } from '../api.js';
import { getSocket } from '../socket.js';

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
// popout for viewing a friend's profile -- with an inline, expandable
// "Friend Settings" panel (Remove Friend + mutual-consent Delete Chat) so
// the profile and the settings for that relationship live in the same
// place instead of requiring a separate navigation step.
export default function ProfileCard({ user, isOwn, token, viewerIsPlus, onClose, onEditProfile, onLogout, onSetBio, onSetDisplayName, onRemoveFriend, onUploadBanner }) {
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState(user.bio || '');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user.displayName || '');
  const [showFriendSettings, setShowFriendSettings] = useState(false);
  const [deleteVotes, setDeleteVotes] = useState({ myVote: false, otherVote: false, autoReset: false });
  const [bannerBusy, setBannerBusy] = useState(false);
  const bannerInputRef = useRef(null);

  // MK ULTRA perk: a profile banner image, uploaded the same way avatars
  // are -- only the profile's own owner can change it, and only if they
  // have ULTRA.
  const canEditBanner = isOwn && !!user.isUltra;

  async function handleBannerFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUploadBanner) return;
    setBannerBusy(true);
    try {
      await onUploadBanner(file);
    } finally {
      setBannerBusy(false);
    }
  }

  const playing = user.statusSource === 'music' ? parsePlaying(user.statusText) : null;
  const memberSince = formatMemberSince(user.createdAt);
  // Free-tier chats always auto-delete after 24h; having MK PLUS or MK
  // ULTRA on either side makes it permanent (matches the server-side sweep,
  // which skips a thread if either participant has PLUS or ULTRA).
  const isPermanentChat = !!(user.isPlus || viewerIsPlus);

  async function handleBioSubmit(e) {
    e.preventDefault();
    await onSetBio(bioDraft);
    setEditingBio(false);
  }

  async function handleNameSubmit(e) {
    e.preventDefault();
    if (onSetDisplayName) await onSetDisplayName(nameDraft);
    setEditingName(false);
  }

  useEffect(() => {
    if (isOwn || !showFriendSettings || !user.threadId || !token) return;
    let cancelled = false;

    api.getDeleteVotes(token, user.threadId).then((votes) => {
      if (!cancelled) setDeleteVotes(votes);
    }).catch(() => {});

    const socket = getSocket();
    function onVoteUpdate({ threadId, myVote, otherVote }) {
      if (threadId === user.threadId) setDeleteVotes((prev) => ({ ...prev, myVote, otherVote }));
    }
    function onDeleted({ threadId }) {
      if (threadId === user.threadId) setDeleteVotes((prev) => ({ ...prev, myVote: false, otherVote: false }));
    }
    socket.on('chat:delete-vote-update', onVoteUpdate);
    socket.on('chat:deleted', onDeleted);

    return () => {
      cancelled = true;
      socket.off('chat:delete-vote-update', onVoteUpdate);
      socket.off('chat:deleted', onDeleted);
    };
  }, [showFriendSettings, user.threadId, isOwn, token]);

  function castDeleteVote(vote) {
    if (!user.threadId) return;
    getSocket().emit('chat:delete-vote', { threadId: user.threadId, vote }, () => {});
  }

  return (
    <div className="profile-card-backdrop" onClick={onClose}>
      <div className="profile-card" onClick={(e) => e.stopPropagation()}>
        <button className="profile-card-close" onClick={onClose} title="Close">Close</button>

        <div
          className={`profile-card-banner ${canEditBanner ? 'profile-card-banner-editable' : ''}`}
          style={user.bannerUrl ? { backgroundImage: `url(${resolveAvatarUrl(user.bannerUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
          onClick={() => canEditBanner && bannerInputRef.current?.click()}
          title={canEditBanner ? 'Change profile banner' : undefined}
        >
          {canEditBanner && <div className="pfp-overlay">{bannerBusy ? '…' : 'Edit'}</div>}
        </div>
        {canEditBanner && (
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleBannerFileChange}
          />
        )}

        <div className="profile-card-body">
          <div className="profile-card-avatar-wrap">
            <Avatar username={user.displayName || user.username} avatarColor={user.avatarColor} avatarUrl={user.avatarUrl} size={72} className="profile-card-avatar" ultraBorder={user.isUltra} />
            <span className="profile-card-status-dot" style={{ background: isOwn || user.online ? '#3ba55d' : '#747f8d' }} />
          </div>

          {isOwn && editingName ? (
            <form onSubmit={handleNameSubmit} className="profile-card-name-form">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleNameSubmit}
                placeholder={user.username}
                maxLength={32}
              />
            </form>
          ) : (
            <div
              className={`profile-card-name ${isOwn ? 'profile-card-name-editable' : ''}`}
              style={user.nameColor ? { color: user.nameColor } : undefined}
              onClick={isOwn ? () => { setNameDraft(user.displayName || ''); setEditingName(true); } : undefined}
              title={isOwn ? 'Click to change your display name' : undefined}
            >
              {user.displayName || user.username}
              {user.isUltra && <span className="ultra-badge" title="MK ULTRA">ULTRA</span>}
              {!user.isUltra && user.isPremium && <span className="premium-badge" title="MK PREMIUM">PREMIUM</span>}
              {!user.isUltra && !user.isPremium && user.isPlus && <span className="plus-badge" title="MK PLUS">PLUS</span>}
            </div>
          )}
          <div className="profile-card-sub">
            <span>{user.username.toLowerCase()}</span>
                        <span className="profile-card-sub-badge">MK</span>
          </div>

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
                  <div className="profile-card-playing-info">
                    <div className="profile-card-playing-title">{playing.title}</div>
                    {playing.artist && <div className="profile-card-playing-artist">{playing.artist}</div>}
                  </div>
                  <div className="profile-card-eq" aria-hidden="true">
                    <span /><span /><span /><span />
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
              <div className="profile-card-membersince">{memberSince}</div>
            </div>
          )}

          {isOwn ? (
            <>
              <button className="profile-card-edit-btn" onClick={onEditProfile}>Edit Status</button>
              <div className="profile-card-row">
                <span className="profile-card-row-left">
                  <span className="profile-card-row-dot" />
                  <span>Online</span>
                </span>
              </div>
              <div className="profile-card-row profile-card-row-clickable" onClick={onLogout}>
                <span className="profile-card-row-left">Log Out</span>
                <span className="profile-card-row-chevron">›</span>
              </div>
            </>
          ) : (
            <>
              <div className="profile-card-row">
                <span className="profile-card-row-left">
                  <span className="profile-card-row-dot" style={{ background: user.online ? '#3ba55d' : '#747f8d' }} />
                  <span>{user.online ? 'Online' : 'Offline'}</span>
                </span>
              </div>
              {user.threadId && (
                <div className="profile-card-row profile-card-row-clickable" onClick={() => setShowFriendSettings((v) => !v)}>
                  <span className="profile-card-row-left">Friend Settings</span>
                  <span className="profile-card-row-chevron">{showFriendSettings ? '⌄' : '›'}</span>
                </div>
              )}
              {showFriendSettings && (
                <div className="profile-friend-settings">
                  {onRemoveFriend && (
                    <button
                      type="button"
                      className="profile-friend-settings-remove"
                      onClick={() => onRemoveFriend(user.id)}
                    >
                      Remove Friend
                    </button>
                  )}

                  <div className="profile-friend-settings-divider" />

                  <div className="profile-friend-settings-label">Delete Chat</div>
                  <div className="profile-friend-settings-text">
                    Both people must agree to permanently delete every message in this chat.
                  </div>
                  <div className="profile-friend-settings-status">
                    You: {deleteVotes.myVote ? 'Yes' : 'No vote'}<br />
                    {user.displayName || user.username}: {deleteVotes.otherVote ? 'Yes' : 'No vote'}
                  </div>
                  {deleteVotes.myVote ? (
                    <button type="button" className="secondary" onClick={() => castDeleteVote(false)}>Cancel my vote</button>
                  ) : (
                    <button type="button" className="danger-btn" onClick={() => castDeleteVote(true)}>Vote to delete</button>
                  )}

                  <div className="profile-friend-settings-divider" />

                  <div className="dropdown-info-row">
                    <span className="dropdown-toggle-label">
                      {isPermanentChat
                        ? 'Permanent chat (MK PLUS)'
                        : 'Messages auto-delete after 24h — get MK PLUS for permanent chats'}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
