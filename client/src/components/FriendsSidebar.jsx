import { useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import ProfileCard from './ProfileCard.jsx';
import AvatarCropper from './AvatarCropper.jsx';
import { groupDisplayName } from './MiniChatView.jsx';

export default function FriendsSidebar({
  friends, activeFriendId, onSelect, currentUser, token, onLogout, onChangeAvatar, onSetBio,
  onOpenChatSettings, onRemoveFriend, groups, activeGroupId, onSelectGroup, onCreateGroup,
}) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [showProfileCard, setShowProfileCard] = useState(false);
  const [viewingFriend, setViewingFriend] = useState(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [croppingFile, setCroppingFile] = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState('');

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // MK ULTRA perk: skip the crop/rasterize step for GIFs so the animation
    // survives -- the cropper's canvas draw would otherwise flatten it to a
    // single static frame.
    if (currentUser.isUltra && file.type === 'image/gif') {
      setUploading(true);
      try {
        await onChangeAvatar(file);
      } finally {
        setUploading(false);
      }
      return;
    }
    setCroppingFile(file);
  }

  async function handleCropConfirm(blob) {
    setCroppingFile(null);
    setUploading(true);
    try {
      await onChangeAvatar(new File([blob], 'avatar.png', { type: 'image/png' }));
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    setCreatingGroup(true);
    setCreateGroupError('');
    try {
      await onCreateGroup(newGroupName.trim());
      setShowCreateGroup(false);
      setNewGroupName('');
    } catch (err) {
      setCreateGroupError(err.message || 'Failed to create Mini Chat');
    } finally {
      setCreatingGroup(false);
    }
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
            <Avatar username={currentUser.username} avatarColor={currentUser.avatarColor} avatarUrl={currentUser.avatarUrl} size={44} />
            <div className="pfp-overlay">Edit</div>
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
              {currentUser.isUltra && <span className="ultra-badge" title="MK ULTRA">ULTRA</span>}
            </div>
            <div
              className={`activity-status ${currentUser.statusSource !== 'music' ? 'activity-status-hint' : ''}`}
            >
              {currentUser.statusSource === 'music' && currentUser.statusText
                ? currentUser.statusText
                : 'Connect MusicToDiscord to show your song playing on Apple Music!'}
            </div>
          </div>
        </div>
      </div>

      <div className="minichat-list">
        <div className="minichat-list-header">
          <span>Mini Chats</span>
          <span className="minichat-create-btn" onClick={() => setShowCreateGroup(true)} title="Create a Mini Chat">+</span>
        </div>
        {(groups || []).map((g) => (
          <div
            key={g.id}
            className={`friend-row ${activeGroupId === g.id ? 'active' : ''}`}
            onClick={() => onSelectGroup(g.id)}
          >
            <Avatar username={groupDisplayName(g, currentUser.id)} avatarColor="#6e1f22" size={40} />
            <div className="friend-info">
              <span className="friend-name">{groupDisplayName(g, currentUser.id)}</span>
              <span className="friend-status">{(g.members || []).length}/15 members</span>
            </div>
          </div>
        ))}
      </div>

      {showCreateGroup && (
        <div className="modal-overlay" onClick={() => !creatingGroup && setShowCreateGroup(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create a Mini Chat</h2>
            <p className="server-rail-create-hint">
              A free group chat for up to 15 people, no channels or roles. You can add members by username afterwards.
            </p>
            <form onSubmit={handleCreateGroup}>
              <div className="settings-section">
                <div className="settings-label">Name (optional)</div>
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Leave blank to use member names"
                  maxLength={60}
                />
              </div>
              {createGroupError && <div className="form-error">{createGroupError}</div>}
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setShowCreateGroup(false)} disabled={creatingGroup}>Cancel</button>
                <button type="submit" disabled={creatingGroup}>{creatingGroup ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

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
              <Avatar username={f.username} avatarColor={f.avatarColor} avatarUrl={f.avatarUrl} size={40} online={f.online} />
            </div>
            <div className="friend-info">
              <span className="friend-name">
                {f.username}
                {f.isUltra && <span className="ultra-badge" title="MK ULTRA">ULTRA</span>}
              </span>
              {f.statusSource === 'music' && f.statusText && <span className="friend-status">{f.statusText}</span>}
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
          token={token}
          viewerIsUltra={currentUser.isUltra}
          onClose={() => setViewingFriend(null)}
          onRemoveFriend={(friendId) => {
            setViewingFriend(null);
            onRemoveFriend(friendId);
          }}
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
                    size={72}
                  />
                  <div className="pfp-overlay">{uploading ? '…' : 'Edit'}</div>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowEditProfile(false)}>Close</button>
              <button onClick={() => setShowEditProfile(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {croppingFile && (
        <AvatarCropper
          file={croppingFile}
          onCancel={() => setCroppingFile(null)}
          onConfirm={handleCropConfirm}
        />
      )}
    </div>
  );
}
