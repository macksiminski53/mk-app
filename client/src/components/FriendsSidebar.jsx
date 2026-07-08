import { useRef, useState } from 'react';
import Avatar from './Avatar.jsx';

export default function FriendsSidebar({ friends, activeFriendId, onSelect, currentUser, onLogout, onChangeAvatar, onSetStatus }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState(currentUser.statusText || '');

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
            onClick={() => fileInputRef.current?.click()}
            title="Change profile picture"
          >
            <Avatar username={currentUser.username} avatarColor={currentUser.avatarColor} avatarUrl={currentUser.avatarUrl} size={44} />
            <div className="pfp-overlay">{uploading ? '…' : '✎'}</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <div className="activity-info">
            <div className="activity-username">{currentUser.username}</div>
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
              <div className="activity-status" onClick={() => setEditingStatus(true)} title="Click to edit your status">
                {currentUser.statusText || 'Set a status…'}
              </div>
            )}
          </div>
          <button className="logout-btn" onClick={onLogout} title="Log out">⏻</button>
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
            <div className="friend-avatar-wrap">
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
    </div>
  );
}
