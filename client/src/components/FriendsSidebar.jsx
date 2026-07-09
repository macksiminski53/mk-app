import { useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import ProfileCard from './ProfileCard.jsx';

export default function FriendsSidebar({ friends, activeFriendId, onSelect, currentUser, onLogout, onChangeAvatar, onSetStatus, onSetBio }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState(currentUser.statusText || '');
  const [showProfileCard, setShowProfileCard] = useState(false);
  const [viewingFriend, setViewingFriend] = useState(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [avatarSize, setAvatarSize] = useState(() => {
    const saved = Number(localStorage.getItem('mk-avatar-size'));
    return saved >= 40 && saved <= 120 ? saved : 44;
  });

  function handleAvatarSizeChange(size) {
    setAvatarSize(size);
    localStorage.setItem('mk-avatar-size', String(size));
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await onChangeAvatar(file);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleStatusSubmit(e) {
    e.preventDefault();
    await onSetStatus(statusDraft);
    setEditingStatus(false);
  }

  return (
    <div className="friends-sidebar">
      <div className="activity-panel">
        <div className="activity-panel-title">Activity</div>
        <div className="activity-panel-body">
          <div
            className="pfp-change-wrap"
            onClick={() => setShowEditProfile(true)}
            title="Edit profile"
          >
            <Avatar username={currentUser.username} avatarColor={currentUser.avatarColor} avatarUrl={currentUser.avatarUrl} size={avatarSize} />
            <div className="pfp-overlay">✎</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <div className="activity-info">
            <div className="activity-username" onClick={() => setShowProfileCard(true)} title="View profile">
              {currentUser.username}
            </div>
            {editingStatus ? (
              <form onSubmit={handleStatusSubmit} className="status-edit-form">
                <input
                  autoFocus
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value)}
                  onBlur={handleStatusSubmit}
                  placeholder="Song - Artist, or any status"
                  maxLength={120}
                />
              </form>
            ) : (
              <div
                className={`activity-status ${!currentUser.statusText ? 'activity-status-hint' : ''}`}
                onClick={() => setEditingStatus(true)}
                title="Click to edit your status"
              >
                {currentUser.statusText || 'Connect MusicToDiscord to show your song playing on Apple Music!'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="friends-list">
        {friends.length === 0 && (
          <div className="friends-empty">No friends yet. Add one from the Friend Request panel above.</div>
        )}
        {friends.map((f) => (
          <div
            key={f.id}
            className={`friend-row ${activeFriendId === f.id ? 'active' : ''}`}
            onClick={() => onSelect(f)}
          >
            <div
              className="friend-avatar-wrap"
              onClick={(e) => { e.stopPropagation(); setViewingFriend(f); }}
              title={`View ${f.username}'s profile`}
            >
              <Avatar username={f.username} avatarColor={f.avatarColor} avatarUrl={f.avatarUrl} size={40} />
              <span className="status-dot" style={{ background: f.online ? '#3ba55d' : '#747f8d' }} />
            </div>
            <div className="friend-info">
              <span className="friend-name">{f.username}</span>
              {f.statusText && <span className="friend-status">{f.statusText}</span>}
            </div>
          </div>
        ))}
      </div>

      {showProfileCard && (
        <ProfileCard
          user={currentUser}
          isOwn
          onClose={() => setShowProfileCard(false)}
          onLogout={onLogout}
          onSetBio={onSetBio}
          onEditProfile={() => {
            setShowProfileCard(false);
            setShowEditProfile(true);
          }}
        />
      )}

      {viewingFriend && (
        <ProfileCard
          user={viewingFriend}
          isOwn={false}
          onClose={() => setViewingFriend(null)}
        />
      )}

      {showEditProfile && (
        <div className="modal-overlay" onClick={() => setShowEditProfile(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Profile</h2>

            <div className="settings-section">
              <div className="settings-label">Profile Picture</div>
              <div className="edit-avatar-row">
                <div
                  className="pfp-change-wrap"
                  onClick={() => fileInputRef.current?.click()}
                  title="Change profile picture"
                >
                  <Avatar
                    username={currentUser.username}
                    avatarColor={currentUser.avatarColor}
                    avatarUrl={currentUser.avatarUrl}
                    size={avatarSize}
                  />
                  <div className="pfp-overlay">{uploading ? '…' : '✎'}</div>
                </div>
              </div>
              <div className="avatar-size-row">
                <span className="avatar-size-label">Size</span>
                <input
                  type="range"
                  min="40"
                  max="120"
                  value={avatarSize}
                  onChange={(e) => handleAvatarSizeChange(Number(e.target.value))}
                />
                <span className="avatar-size-value">{avatarSize}px</span>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-label">Status</div>
              <form onSubmit={handleStatusSubmit} className="status-edit-form">
                <input
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value)}
                  placeholder="Song - Artist, or any status"
                  maxLength={120}
                />
              </form>
            </div>

            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowEditProfile(false)}>Close</button>
              <button onClick={async () => { await onSetStatus(statusDraft); setShowEditProfile(false); }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
