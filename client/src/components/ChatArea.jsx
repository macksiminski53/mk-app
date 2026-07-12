import { useEffect, useRef, useState } from 'react';
import { api, resolveAvatarUrl } from '../api.js';
import { getSocket } from '../socket.js';
import Avatar from './Avatar.jsx';
import { PhoneIcon } from './CallIcons.jsx';
import { BackIcon, PinIcon } from './Icons.jsx';
import CassettePlayer from './CassettePlayer.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import GifPicker from './GifPicker.jsx';
import LikeButton from './LikeButton.jsx';
import PinButton from './PinButton.jsx';
import PinnedPanel from './PinnedPanel.jsx';
import ReactionPicker from './ReactionPicker.jsx';
import MentionAutocomplete from './MentionAutocomplete.jsx';
import MessageContextMenu from './MessageContextMenu.jsx';
import { renderMessageContent, getMentionQuery, applyMentionPick } from './MessageContent.jsx';

function formatTime(createdAt) {
  if (!createdAt) return '';
  // Server stores "YYYY-MM-DD HH:MM:SS" (SQLite datetime('now')) with no
  // "T" separator -- Safari/iOS rejects that shape outright (Invalid Date)
  // even though Chrome tolerates it, so normalize it first like the other
  // chat views already do.
  const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // Once a message is 12+ hours old, the time alone gets ambiguous (was
  // that 3:45 today or yesterday?) -- tack the date on from that point.
  const hoursAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  if (hoursAgo >= 12) {
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${date} ${time}`;
  }
  return time;
}

function truncate(text, max = 80) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function isAudioUrl(url) {
  return /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(url || '');
}

function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(url || '');
}

function isVideoUrl(url) {
  return /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(url || '');
}

// Server renames uploads to `attachment-<userId>-<timestamp>.<ext>`, so the
// only thing worth surfacing to the user from the URL is the extension --
// used for the generic "download this file" fallback below.
function fileExtLabel(url) {
  const m = /\.([a-z0-9]+)$/i.exec(url || '');
  return m ? m[1].toUpperCase() : 'FILE';
}

export default function ChatArea({ token, friend, currentUser, onRemoveFriend, onStartCall, callActive, chatLayout = 'bubble', openSettingsTrigger, onBack, t }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeletePanel, setShowDeletePanel] = useState(false);
  const [deleteVotes, setDeleteVotes] = useState({ myVote: false, otherVote: false, autoReset: false });
  const [replyTo, setReplyTo] = useState(null); // { id, username, content }
  const [pendingImage, setPendingImage] = useState(null); // { file, previewUrl, isAudio }
  const [uploading, setUploading] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null); // url or null
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [theirLastRead, setTheirLastRead] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [contextMenu, setContextMenu] = useState(null); // { message, x, y }
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const fileInputRef = useRef(null);
  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const threadId = friend?.threadId;
  const isBubble = chatLayout === 'bubble';
  // Free-tier chats always auto-delete after 24h; having MK PLUS or MK
  // ULTRA on either side of the conversation makes it permanent (matches
  // the server-side sweep, which skips a thread if either participant has
  // PLUS or ULTRA).
  const isPermanentChat = !!(currentUser?.isPlus || friend?.isPlus);
  // MK ULTRA perk: read receipts only show up if at least one side of the
  // conversation has ULTRA -- tracking itself is free/always-on server-side.
  const readReceiptsEnabled = !!(currentUser?.isUltra || friend?.isUltra);

  // Force-open the settings dropdown when requested from elsewhere (e.g. a
  // friend's profile card "Chat Settings" link). The trigger is a counter
  // that only ever increments, so any change (after the initial mount)
  // means "please open it now".
  const prevTriggerRef = useRef(openSettingsTrigger);
  useEffect(() => {
    if (openSettingsTrigger !== undefined && openSettingsTrigger !== prevTriggerRef.current) {
      prevTriggerRef.current = openSettingsTrigger;
      setShowSettings(true);
    }
  }, [openSettingsTrigger]);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setMessages([]);
    setReplyTo(null);
    setPendingImage(null);
    setShowDeletePanel(false);
    setDeleteVotes({ myVote: false, otherVote: false, autoReset: false });
    api.listMessages(token, threadId).then((msgs) => {
      if (!cancelled) setMessages(msgs);
    });
    api.getDeleteVotes(token, threadId).then((votes) => {
      if (!cancelled) setDeleteVotes(votes);
    }).catch(() => {});
    setPinnedMessages([]);
    api.listPinnedDm(token, threadId).then((rows) => {
      if (!cancelled) setPinnedMessages(rows);
    }).catch(() => {});
    setTheirLastRead(0);
    api.getReadState(token, threadId).then((res) => {
      if (!cancelled) setTheirLastRead(res.theirLastRead || 0);
    }).catch(() => {});

    const socket = getSocket();
    socket.emit('thread:join', threadId);

    function onNewMessage({ threadId: tid, message }) {
      if (tid === threadId) setMessages((prev) => [...prev, message]);
    }
    function onTyping({ threadId: tid, username, isTyping }) {
      if (tid !== threadId || username === currentUser.username) return;
      setTyping(isTyping);
    }
    function onDeleteVoteUpdate({ threadId: tid, myVote, otherVote }) {
      if (tid === threadId) setDeleteVotes((prev) => ({ ...prev, myVote, otherVote }));
    }
    function onChatDeleted({ threadId: tid }) {
      if (tid !== threadId) return;
      setMessages([]);
      setDeleteVotes((prev) => ({ ...prev, myVote: false, otherVote: false }));
      setShowDeletePanel(false);
    }

    function onLikeUpdate({ messageType, messageId, likeCount }) {
      if (messageType !== 'dm') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, likeCount } : m)));
    }

    function onPinUpdate({ messageType, messageId, pinned, pinnedByUsername }) {
      if (messageType !== 'dm') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pinned, pinnedByUsername: pinned ? pinnedByUsername : null } : m)));
      setPinnedMessages((prev) => {
        if (!pinned) return prev.filter((m) => m.id !== messageId);
        if (prev.some((m) => m.id === messageId)) return prev;
        const source = messagesRef.current.find((m) => m.id === messageId);
        return source ? [...prev, source] : prev;
      });
    }

    function onReadUpdate({ threadId: tid, userId: fromUserId, lastReadMessageId }) {
      if (tid !== threadId || fromUserId !== friend.id) return;
      setTheirLastRead((prev) => Math.max(prev, lastReadMessageId));
    }

    function onReactionsUpdate({ messageType, messageId, reactions }) {
      if (messageType !== 'dm') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
    }

    function onEditUpdate({ messageType, messageId, content, editedAt }) {
      if (messageType !== 'dm') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content, editedAt } : m)));
    }

    // An admin deleted this message via the admin panel/context menu --
    // remove it from local state for everyone currently viewing the thread.
    function onMessageDeleted({ messageType, messageId }) {
      if (messageType !== 'dm') return;
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    }

    socket.on('message:new', onNewMessage);
    socket.on('typing', onTyping);
    socket.on('chat:delete-vote-update', onDeleteVoteUpdate);
    socket.on('chat:deleted', onChatDeleted);
    socket.on('message:like-update', onLikeUpdate);
    socket.on('message:pin-update', onPinUpdate);
    socket.on('thread:read-update', onReadUpdate);
    socket.on('message:reactions-update', onReactionsUpdate);
    socket.on('message:edit-update', onEditUpdate);
    socket.on('message:deleted', onMessageDeleted);

    return () => {
      cancelled = true;
      socket.emit('thread:leave', threadId);
      socket.off('message:new', onNewMessage);
      socket.off('typing', onTyping);
      socket.off('chat:delete-vote-update', onDeleteVoteUpdate);
      socket.off('chat:deleted', onChatDeleted);
      socket.off('message:like-update', onLikeUpdate);
      socket.off('message:pin-update', onPinUpdate);
      socket.off('thread:read-update', onReadUpdate);
      socket.off('message:reactions-update', onReactionsUpdate);
      socket.off('message:edit-update', onEditUpdate);
      socket.off('message:deleted', onMessageDeleted);
    };
  }, [threadId]);

  function toggleLike(messageId) {
    getSocket().emit('message:like', { messageType: 'dm', messageId, roomId: threadId }, (res) => {
      if (res?.error) return console.error(res.error);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, likeCount: res.likeCount, likedByMe: res.likedByMe } : m)));
    });
  }

  function togglePin(messageId) {
    getSocket().emit('message:pin', { messageType: 'dm', messageId, roomId: threadId }, (res) => {
      if (res?.error) return console.error(res.error);
    });
  }

  function unpinFromPanel(messageId) {
    togglePin(messageId);
  }

  function toggleReaction(messageId, emoji) {
    getSocket().emit('message:react', { messageType: 'dm', messageId, roomId: threadId, emoji }, (res) => {
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
    getSocket().emit('message:edit', { messageType: 'dm', messageId, roomId: threadId, content: trimmed }, (res) => {
      if (res?.error) return console.error(res.error);
      cancelEdit();
    });
  }

  // Admin-only: deletes any message regardless of author, via the REST API
  // (server/routes/admin.js) rather than the normal socket path -- the
  // resulting broadcast still arrives over the socket as 'message:deleted'.
  function adminDeleteMessage(messageId) {
    api.adminDeleteMessage(token, 'dm', messageId, threadId).catch((err) => console.error(err.message));
  }

  function pickMention(username) {
    setDraft((prev) => applyMentionPick(prev, username));
  }

  function openContextMenu(e, m) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 170);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setContextMenu({ message: m, x, y });
  }

  function castDeleteVote(vote) {
    getSocket().emit('chat:delete-vote', { threadId, vote }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // MK ULTRA perk: mark the thread as read (up through the newest message)
  // whenever it's open and messages change -- this is what lets the other
  // side's client show a "Seen" indicator. Tracking is cheap enough to just
  // always send; readReceiptsEnabled only controls whether *we* render one.
  useEffect(() => {
    if (!threadId || messages.length === 0) return;
    const lastId = messages[messages.length - 1].id;
    getSocket().emit('thread:mark-read', { threadId, lastMessageId: lastId });
  }, [threadId, messages]);

  function sendTyping(isTyping) {
    getSocket().emit('typing', { threadId, username: currentUser.username, isTyping });
  }

  function handleChange(e) {
    setDraft(e.target.value);
    sendTyping(true);
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => sendTyping(false), 1500);
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    setPendingImage({
      file,
      previewUrl: isImage ? URL.createObjectURL(file) : null,
      isImage,
    });
    e.target.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!draft.trim() && !pendingImage) return;

    let imageUrl = null;
    if (pendingImage) {
      setUploading(true);
      try {
        const res = await api.uploadAttachment(token, threadId, pendingImage.file);
        imageUrl = res.imageUrl;
      } catch (err) {
        console.error('Image upload failed:', err.message);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    getSocket().emit(
      'message:send',
      { threadId, content: draft.trim(), replyToId: replyTo?.id || null, imageUrl },
      (res) => {
        if (res?.error) console.error(res.error);
      }
    );
    setDraft('');
    setReplyTo(null);
    setPendingImage(null);
    sendTyping(false);
  }

  function sendGif(url) {
    getSocket().emit(
      'message:send',
      { threadId, content: '', replyToId: replyTo?.id || null, imageUrl: url },
      (res) => {
        if (res?.error) console.error(res.error);
      }
    );
    setReplyTo(null);
  }

  if (!friend) {
    return <div className="chat-area empty">{t('selectFriend')}</div>;
  }

  const mentionQuery = getMentionQuery(draft);
  const mentionCandidates = [{ username: friend.username, displayName: friend.displayName }];

  return (
    <div className={`chat-area layout-${isBubble ? 'bubble' : 'flat'}`}>
      <div className="chat-header">
        {onBack && (
          <button type="button" className="mobile-back-btn" onClick={onBack} title="Back">
            <BackIcon />
          </button>
        )}
        <span className="chat-header-name">
          {friend.displayName || friend.username}
          {friend.isUltra && <span className="ultra-badge" title="MK ULTRA">ULTRA</span>}
          {!friend.isUltra && friend.isPremium && <span className="premium-badge" title="MK PREMIUM">PREMIUM</span>}
          {!friend.isUltra && !friend.isPremium && friend.isPlus && <span className="plus-badge" title="MK PLUS">PLUS</span>}
          {friend.isAdmin && <span className="admin-badge" title="MK Admin">ADMIN</span>}
        </span>
        <div className="dropdown-wrap chat-settings-wrap">
          <span
            className="gear-icon"
            onClick={() => { setShowSettings((v) => !v); setShowDeletePanel(false); }}
            title={t('chatSettings')}
          >Settings</span>
          {showSettings && (
            <div className="dropdown-menu dropdown-menu-quality" onMouseLeave={() => { setShowSettings(false); setShowDeletePanel(false); }}>
              {!showDeletePanel ? (
                <>
                  <div
                    className="dropdown-item danger"
                    onClick={() => {
                      setShowSettings(false);
                      onRemoveFriend(friend.id);
                    }}
                  >
                    {t('removeFriend')}
                  </div>
                  <div className="dropdown-item danger" onClick={() => setShowDeletePanel(true)}>
                    Delete Chat
                  </div>
                  <div className="dropdown-info-row">
                                        <span className="dropdown-toggle-label">
                      {isPermanentChat
                        ? 'Permanent chat (MK PLUS)'
                        : 'Messages auto-delete after 24h — get MK PLUS for permanent chats'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="delete-chat-panel">
                  <div className="delete-chat-panel-text">
                    Both people must agree to permanently delete every message in this chat.
                  </div>
                  <div className="delete-chat-panel-status">
                    You: {deleteVotes.myVote ? 'Yes' : 'No vote'}<br />
                    {friend.displayName || friend.username}: {deleteVotes.otherVote ? 'Yes' : 'No vote'}
                  </div>
                  {deleteVotes.myVote ? (
                    <button className="secondary" onClick={() => castDeleteVote(false)}>Cancel my vote</button>
                  ) : (
                    <button className="danger-btn" onClick={() => castDeleteVote(true)}>Vote to delete</button>
                  )}
                  <div className="dropdown-item" onClick={() => setShowDeletePanel(false)}>‹ Back</div>
                </div>
              )}
            </div>
          )}
        </div>
        <span className={`chat-header-status ${friend.online ? 'online' : ''}`}>
          {friend.online ? t('online') : t('offline')}
        </span>
        <span className="megachat-footer-btn pinned-header-btn" onClick={() => setShowPinnedPanel(true)}>
          <PinIcon size={12} /> Pinned ({pinnedMessages.length}/10)
        </span>
        <button
          className="call-header-btn call-header-btn-right"
          onClick={() => onStartCall(friend)}
          disabled={callActive}
          title={callActive ? 'Already on a call' : `Call ${friend.displayName || friend.username}`}
        >
          <PhoneIcon size={16} />
        </button>
      </div>

      <div className="message-list">
        {(() => {
          const lastOwnMessageId = [...messages].reverse().find((m) => m.username === currentUser.username)?.id;
          return messages.map((m) => {
          const isOwn = m.username === currentUser.username;
          const showSeen = readReceiptsEnabled && isOwn && m.id === lastOwnMessageId && theirLastRead >= m.id;
          return (
            <div key={m.id} className={`message-row ${isOwn ? 'own' : 'friend'}`} onContextMenu={(e) => openContextMenu(e, m)}>
              {(!isBubble || !isOwn) && (
                <Avatar username={m.displayName || m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={isBubble ? 32 : 40} ultraBorder={m.isUltra} />
              )}
              <div className="message-body">
                {(!isBubble || !isOwn) && (
                  <div className="message-header">
                    <span className="message-author" style={m.nameColor ? { color: m.nameColor } : undefined}>{m.displayName || m.username}</span>
                    <span className="message-time">{formatTime(m.createdAt)}</span>
                    {m.pinned && <span className="pinned-tag" title={m.pinnedByUsername ? `Pinned by ${m.pinnedByUsername}` : 'Pinned'}><PinIcon size={10} /> Pinned</span>}
                  </div>
                )}

                {m.replyToId && (
                  <div className="reply-reference">
                    Reply to <span className="reply-author">@{m.replyToUsername || 'unknown'}</span>{' '}
                    {truncate(m.replyToContent, 60)}
                  </div>
                )}

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
                  m.content && (
                    <div className="message-content">
                      {renderMessageContent(m.content, m.customEmojiUrl, currentUser?.username)}
                      {m.editedAt && <span className="edited-tag">(edited)</span>}
                    </div>
                  )
                )}
                {m.imageUrl && (
                  isAudioUrl(m.imageUrl) ? (
                    <CassettePlayer src={resolveAvatarUrl(m.imageUrl)} />
                  ) : isImageUrl(m.imageUrl) ? (
                    <img
                      className="message-image"
                      src={resolveAvatarUrl(m.imageUrl)}
                      alt="attachment"
                      onClick={() => setZoomedImage(resolveAvatarUrl(m.imageUrl))}
                    />
                  ) : isVideoUrl(m.imageUrl) ? (
                    <video className="message-video" controls src={resolveAvatarUrl(m.imageUrl)} />
                  ) : (
                    <a
                      className="message-file"
                      href={resolveAvatarUrl(m.imageUrl)}
                      target="_blank"
                      rel="noreferrer"
                      download
                    >
                      {fileExtLabel(m.imageUrl)} file — download
                    </a>
                  )
                )}

                {isBubble && isOwn && (
                  <span className="message-time bubble-time">{formatTime(m.createdAt)}</span>
                )}

                <div className="message-actions-row">
                  <button
                    className="reply-btn"
                    onClick={() => setReplyTo({ id: m.id, username: m.username, content: m.content })}
                    title={t('reply')}
                  >
                    {t('reply')}
                  </button>
                  {isOwn && m.content && (
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
                {showSeen && <div className="seen-indicator">Seen</div>}
              </div>
            </div>
          );
          });
        })()}
        <div ref={bottomRef} />
      </div>

      <div className="typing-indicator">
        {typing && t('isTyping', friend.displayName || friend.username)}
      </div>

      {replyTo && (
        <div className="reply-banner">
          {t('replyingTo')} <strong>@{replyTo.username}</strong>: {truncate(replyTo.content, 60)}
          <span className="reply-cancel" onClick={() => setReplyTo(null)}>Cancel</span>
        </div>
      )}

      {pendingImage && (
        <div className="pending-image-banner">
          {pendingImage.isImage ? (
            <img src={pendingImage.previewUrl} alt="pending attachment" />
          ) : (
            <span className="pending-audio-label">{pendingImage.file.name}</span>
          )}
          <span className="reply-cancel" onClick={() => setPendingImage(null)}>Remove</span>
        </div>
      )}

      {zoomedImage && (
        <div className="image-lightbox" onClick={() => setZoomedImage(null)}>
          <img src={zoomedImage} alt="full size" />
          <button className="image-lightbox-close" onClick={() => setZoomedImage(null)}>Close</button>
        </div>
      )}

      {showPinnedPanel && (
        <PinnedPanel
          pinned={pinnedMessages}
          onUnpin={unpinFromPanel}
          onClose={() => setShowPinnedPanel(false)}
        />
      )}

      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canEdit={contextMenu.message.username === currentUser.username && !!contextMenu.message.content}
          pinned={!!contextMenu.message.pinned}
          onReply={() => setReplyTo({ id: contextMenu.message.id, username: contextMenu.message.username, content: contextMenu.message.content })}
          onEdit={() => startEdit(contextMenu.message)}
          onReact={(emoji) => toggleReaction(contextMenu.message.id, emoji)}
          onPin={() => togglePin(contextMenu.message.id)}
          onAdminDelete={currentUser?.isAdmin ? () => adminDeleteMessage(contextMenu.message.id) : null}
          onClose={() => setContextMenu(null)}
        />
      )}

      <form className="message-input-row" onSubmit={handleSubmit}>
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title={t('attachImage')}
        >
          Attach
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        {currentUser?.isPremium && (
          <EmojiPicker onSelect={(emoji) => setDraft((prev) => prev + emoji)} customEmojiUrl={currentUser?.customEmojiUrl} />
        )}
        <GifPicker token={token} onSend={sendGif} />
        <div className="mention-input-wrap">
          {mentionQuery !== null && (
            <MentionAutocomplete query={mentionQuery} candidates={mentionCandidates} onPick={pickMention} />
          )}
          <input
            value={draft}
            onChange={handleChange}
            placeholder={t('messagePlaceholder', friend.displayName || friend.username)}
          />
        </div>
        <button type="submit" disabled={uploading}>{uploading ? t('sending') : t('send')}</button>
      </form>
    </div>
  );
}
