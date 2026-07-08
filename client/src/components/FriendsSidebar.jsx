import { useRef, useState } from 'react';
import Avatar from './Avatar.jsx';

export default function FriendsSidebar({ friends, activeFriendId, onSelect, currentUser, onLogout, onChangeAvatar }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

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

  return (
    <div className="friends-sidebar">
      <div className="friends-sidebar-header">
        <span className="friends-title">Friends</span>
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
            <div className="friend-avatar-wrap">
              <Avatar username={f.username} avatarColor={f.avatarColor} avatarUrl={f.avatarUrl} size={40} />
              <span className="status-dot" style={{ background: f.online ? '#3ba55d' : '#747f8d' }} />
            </div>
            <span className="friend-name">{f.username}</span>
          </div>
        ))}
      </div>

      <div className="user-footer">
        <div
          className="pfp-change-wrap"
          onClick={() => fileInputRef.current?.click()}
          title="Change profile picture"
        >
          <Avatar username={currentUser.username} avatarColor={currentUser.avatarColor} avatarUrl={currentUser.avatarUrl} size={36} />
          <div className="pfp-overlay">{uploading ? '…' : '✎'}</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <div className="user-footer-name">{currentUser.username}</div>
        <button className="logout-btn" onClick={onLogout} title="Log out">⏻</button>
      </div>
    </div>
  );
}
