import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import AvatarCropper from './AvatarCropper.jsx';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import EmojiPicker from './EmojiPicker.jsx';
import GifPicker from './GifPicker.jsx';
import LikeButton from './LikeButton.jsx';
import PinButton from './PinButton.jsx';
import { BackIcon, PinIcon } from './Icons.jsx';
import PinnedPanel from './PinnedPanel.jsx';
import ReactionPicker from './ReactionPicker.jsx';
import MentionAutocomplete from './MentionAutocomplete.jsx';
import { renderMessageContent, getMentionQuery, applyMentionPick } from './MessageContent.jsx';

function formatTime(createdAt) {
  if (!createdAt) return '';
  const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  // Once a message is 12+ hours old, the time alone gets ambiguous (was
  // that 3:45 today or yesterday?) -- tack the date on from that point.
  const hoursAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  if (hoursAgo >= 12) {
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${date} ${time}`;
  }
  return time;
}

export function groupDisplayName(group, currentUserId) {
  if (group.name) return group.name;
  const others = (group.members || []).filter((m) => m.id !== currentUserId).map((m) => m.displayName || m.username);
  return others.length ? others.join(', ') : 'Just you';
}

// A free, flat (no channels/roles) group chat capped at 15 members. Mirrors
// MegaChatView's message-list pattern but with a single implicit "channel"
// (the group itself) and a simpler members panel -- any member can add
// another member or leave; there's no owner/kick action.
export default function MiniChatView({ group, token, currentUser, onLeft, onBack }) {
  const [members, setMembers] = useState(group.members || []);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addError, setAddError] = useState('');
  const [croppingFile, setCroppingFile] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const messagesEndRef = useRef(null);
  const avatarInputRef = useRef(null);
  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');

  useEffect(() => {
    setMembers(group.members || []);
  }, [group.id]);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();
    socket.emit('group:join', group.id);
    api.listGroupMessages(token, group.id).then((rows) => {
      if (!cancelled) setMessages(rows);
    }).catch(() => {});
    setPinnedMessages([]);
    api.listPinnedGroup(token, group.id).then((rows) => {
      if (!cancelled) setPinnedMessages(rows);
    }).catch(() => {});

    function onNew({ groupId, message }) {
      if (groupId === group.id) setMessages((prev) => [...prev, message]);
    }
    function onCleared({ groupId }) {
      if (groupId === group.id) setMessages([]);
    }
    function onLikeUpdate({ messageType, messageId, likeCount }) {
      if (messageType !== 'mini') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, likeCount } : m)));
    }
    function onPinUpdate({ messageType, messageId, pinned, pinnedByUsername }) {
      if (messageType !== 'mini') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pinned, pinnedByUsername: pinned ? pinnedByUsername : null } : m)));
      setPinnedMessages((prev) => {
        if (!pinned) return prev.filter((m) => m.id !== messageId);
        if (prev.some((m) => m.id === messageId)) return prev;
        const source = messagesRef.current.find((m) => m.id === messageId);
        return source ? [...prev, source] : prev;
      });
    }
    function onReactionsUpdate({ messageType, messageId, reactions }) {
      if (messageType !== 'mini') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
    }
    function onEditUpdate({ messageType, messageId, content, editedAt }) {
      if (messageType !== 'mini') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content, editedAt } : m)));
    }
    socket.on('group-message:new', onNew);
    socket.on('group-chat:cleared', onCleared);
    socket.on('message:like-update', onLikeUpdate);
    socket.on('message:pin-update', onPinUpdate);
    socket.on('message:reactions-update', onReactionsUpdate);
    socket.on('message:edit-update', onEditUpdate);

    return () => {
      cancelled = true;
      socket.emit('group:leave', group.id);
      socket.off('group-message:new', onNew);
      socket.off('group-chat:cleared', onCleared);
      socket.off('message:like-update', onLikeUpdate);
      socket.off('message:pin-update', onPinUpdate);
      socket.off('message:reactions-update', onReactionsUpdate);
      socket.off('message:edit-update', onEditUpdate);
    };
  }, [group.id, token]);

  function toggleLike(messageId) {
    getSocket().emit('message:like', { messageType: 'mini', messageId, roomId: group.id }, (res) => {
      if (res?.error) return console.error(res.error);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, likeCount: res.likeCount, likedByMe: res.likedByMe } : m)));
    });
  }

  function togglePin(messageId) {
    getSocket().emit('message:pin', { messageType: 'mini', messageId, roomId: group.id }, (res) => {
      if (res?.error) return console.error(res.error);
    });
  }

  function toggleReaction(messageId, emoji) {
    getSocket().emit('message:react', { messageType: 'mini', messageId, roomId: group.id, emoji }, (res) => {
      if (res?.error) return console.error(res.error);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: res.reactions } : m)));
    });
  }

  function startEdit(m) {
    setEditingId(m.id);
    setEditDraft(m.content || '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }

  function saveEdit(messageId) {
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    getSocket().emit('message:edit', { messageType: 'mini', messageId, roomId: group.id, content: trimmed }, (res) => {
      if (res?.error) return console.error(res.error);
      cancelEdit();
    });
  }

  function pickMention(username) {
    setInput((prev) => applyMentionPick(prev, username));
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    setSending(true);
    getSocket().emit('group-message:send', { groupId: group.id, content: trimmed }, (ack) => {
      setSending(false);
      if (ack?.ok) setInput('');
    });
  }

  function sendGif(url) {
    getSocket().emit('group-message:send', { groupId: group.id, content: '', imageUrl: url }, (ack) => {
      if (ack?.error) console.error(ack.error);
    });
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const clean = addUsername.trim();
    if (!clean) return;
    try {
      const res = await api.addGroupMember(token, group.id, clean);
      setMembers(res.members);
      setAddUsername('');
      setAddError('');
    } catch (err) {
      setAddError(err.message || 'Failed to add member');
    }
  }

  function handleAvatarFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setCroppingFile(file);
  }

  async function handleAvatarCropConfirm(blob) {
    setCroppingFile(null);
    setUploadingAvatar(true);
    try {
      await api.uploadGroupAvatar(token, group.id, new File([blob], 'group-avatar.png', { type: 'image/png' }));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleLeave() {
    await api.leaveGroup(token, group.id, currentUser.id);
    onLeft(group.id);
  }

  const displayName = groupDisplayName({ ...group, members }, currentUser.id);
  // MK ULTRA perk: a Mini Chat created by an ULTRA member gets a raised
  // member cap (30 instead of 15) -- derived from the creator's isUltra
  // flag, which is already present on each member row.
  const creatorMember = members.find((m) => m.id === group.createdBy);
  const maxMembers = creatorMember?.isUltra ? 30 : 15;
  const atCap = members.length >= maxMembers;
  const isCreator = group.createdBy === currentUser.id;
  const mentionQuery = getMentionQuery(input);
  const mentionCandidates = members;

  return (
    <div className="megachat-main minichat-main">
      <div className="chat-header minichat-header">
        {onBack && (
          <button type="button" className="mobile-back-btn" onClick={onBack} title="Back">
            <BackIcon />
          </button>
        )}
        <div
          className={`minichat-header-avatar ${isCreator ? 'minichat-header-avatar-editable' : ''}`}
          onClick={() => isCreator && avatarInputRef.current?.click()}
          title={isCreator ? 'Change group picture' : undefined}
        >
          <Avatar username={displayName} avatarColor="#6e1f22" avatarUrl={group.avatarUrl} size={32} />
          {isCreator && <div className="pfp-overlay">{uploadingAvatar ? '…' : 'Edit'}</div>}
        </div>
        {isCreator && (
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarFileChange}
          />
        )}
        <span className="minichat-header-name">{displayName}</span>
        <span className="megachat-footer-btn" onClick={() => setShowMembers((v) => !v)}>
          {showMembers ? 'Hide Members' : `Members (${members.length}/${maxMembers})`}
        </span>
        <span className="megachat-footer-btn" onClick={() => setShowPinnedPanel(true)}>
          <PinIcon size={12} /> Pinned ({pinnedMessages.length}/10)
        </span>
        <span className="megachat-footer-btn megachat-danger" onClick={handleLeave}>Leave</span>
      </div>

      {croppingFile && (
        <AvatarCropper
          file={croppingFile}
          onCancel={() => setCroppingFile(null)}
          onConfirm={handleAvatarCropConfirm}
        />
      )}

      {showMembers ? (
        <div className="megachat-members-panel">
          <form className="megachat-add-member-form" onSubmit={handleAddMember}>
            <input
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              placeholder={atCap ? `Mini Chat is full (${maxMembers}/${maxMembers})` : 'Add member by username'}
              maxLength={40}
              disabled={atCap}
            />
            <button type="submit" disabled={atCap}>Add</button>
          </form>
          {addError && <div className="form-error">{addError}</div>}
          <div className="megachat-members-list">
            {members.map((m) => (
              <div key={m.id} className="megachat-member-row">
                <Avatar username={m.displayName || m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={32} ultraBorder={m.isUltra} />
                <span className="megachat-member-name">
                  {m.displayName || m.username}
                  {m.isUltra && <span className="ultra-badge" title="MK ULTRA">ULTRA</span>}
                  {!m.isUltra && m.isPremium && <span className="premium-badge" title="MK PREMIUM">PREMIUM</span>}
                  {!m.isUltra && !m.isPremium && m.isPlus && <span className="plus-badge" title="MK PLUS">PLUS</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="megachat-message-list">
            {messages.map((m) => (
              <div key={m.id} className="megachat-message-row">
                <Avatar username={m.displayName || m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={36} ultraBorder={m.isUltra} />
                <div className="megachat-message-body">
                  <div className="megachat-message-meta">
                    <span className="megachat-message-username" style={m.nameColor ? { color: m.nameColor } : undefined}>{m.displayName || m.username}</span>
                    <span className="megachat-message-time">{formatTime(m.createdAt)}</span>
                    {m.pinned && <span className="pinned-tag" title={m.pinnedByUsername ? `Pinned by ${m.pinnedByUsername}` : 'Pinned'}><PinIcon size={10} /> Pinned</span>}
                  </div>
                  {editingId === m.id ? (
                    <form
                      className="message-edit-form"
                      onSubmit={(e) => { e.preventDefault(); saveEdit(m.id); }}
                    >
                      <input value={editDraft} onChange={(e) => setEditDraft(e.target.value)} autoFocus />
                      <button type="submit">Save</button>
                      <button type="button" onClick={cancelEdit}>Cancel</button>
                    </form>
                  ) : (
                    <div className="megachat-message-content">
                      {renderMessageContent(m.content, m.customEmojiUrl, currentUser?.username)}
                      {m.editedAt && <span className="edited-tag">(edited)</span>}
                    </div>
                  )}
                  <div className="message-actions-row">
                    {m.userId === currentUser.id && m.content && (
                      <button className="reply-btn" onClick={() => startEdit(m)} title="Edit">
                        Edit
                      </button>
                    )}
                    <LikeButton
                      likeCount={m.likeCount}
                      likedByMe={m.likedByMe}
                      canLike={!!currentUser?.isPremium}
                      onToggle={() => toggleLike(m.id)}
                    />
                    <PinButton pinned={!!m.pinned} onToggle={() => togglePin(m.id)} />
                  </div>
                  <ReactionPicker
                    reactions={m.reactions || []}
                    currentUserId={currentUser?.id}
                    onToggle={(emoji) => toggleReaction(m.id, emoji)}
                  />
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form className="megachat-input-row" onSubmit={handleSend}>
            {currentUser?.isPremium && (
              <EmojiPicker onSelect={(emoji) => setInput((prev) => prev + emoji)} customEmojiUrl={currentUser?.customEmojiUrl} />
            )}
            <GifPicker token={token} onSend={sendGif} />
            <div className="mention-input-wrap">
              {mentionQuery !== null && (
                <MentionAutocomplete query={mentionQuery} candidates={mentionCandidates} onPick={pickMention} />
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Message ${displayName}`}
              />
            </div>
            <button type="submit" disabled={!input.trim() || sending}>Send</button>
          </form>
        </>
      )}

      {showPinnedPanel && (
        <PinnedPanel
          pinned={pinnedMessages}
          onUnpin={togglePin}
          onClose={() => setShowPinnedPanel(false)}
        />
      )}
    </div>
  );
}
