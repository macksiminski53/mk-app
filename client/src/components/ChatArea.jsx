import { useEffect, useRef, useState } from 'react';
import { api, resolveAvatarUrl } from '../api.js';
import { getSocket } from '../socket.js';
import Avatar from './Avatar.jsx';
import { PhoneIcon } from './CallIcons.jsx';

function formatTime(iso) {
  const d = new Date(iso + 'Z');
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

export default function ChatArea({ token, friend, currentUser, onRemoveFriend, onStartCall, callActive, chatLayout = 'bubble', openSettingsTrigger, t }) {
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
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const fileInputRef = useRef(null);

  const threadId = friend?.threadId;
  const isBubble = chatLayout === 'bubble';
  // Free-tier chats always auto-delete after 24h; having MK ULTRA on
  // either side of the conversation makes it permanent (matches the
  // server-side sweep, which skips a thread if either participant is ultra).
  const isPermanentChat = !!(currentUser?.isUltra || friend?.isUltra);

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

    socket.on('message:new', onNewMessage);
    socket.on('typing', onTyping);
    socket.on('chat:delete-vote-update', onDeleteVoteUpdate);
    socket.on('chat:deleted', onChatDeleted);

    return () => {
      cancelled = true;
      socket.emit('thread:leave', threadId);
      socket.off('message:new', onNewMessage);
      socket.off('typing', onTyping);
      socket.off('chat:delete-vote-update', onDeleteVoteUpdate);
      socket.off('chat:deleted', onChatDeleted);
    };
  }, [threadId]);

  function castDeleteVote(vote) {
    getSocket().emit('chat:delete-vote', { threadId, vote }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  if (!friend) {
    return <div className="chat-area empty">{t('selectFriend')}</div>;
  }

  return (
    <div className={`chat-area layout-${isBubble ? 'bubble' : 'flat'}`}>
      <div className="chat-header">
        <span className="chat-header-name">
          {friend.username}
          {friend.isUltra && <span className="ultra-badge" title="MK ULTRA">⚡ ULTRA</span>}
        </span>
        <div className="dropdown-wrap chat-settings-wrap">
          <span
            className="gear-icon"
            onClick={() => { setShowSettings((v) => !v); setShowDeletePanel(false); }}
            title={t('chatSettings')}
          >⚙</span>
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
                    <span className="dropdown-item-icon">👤</span>{t('removeFriend')}
                  </div>
                  <div className="dropdown-item danger" onClick={() => setShowDeletePanel(true)}>
                    <span className="dropdown-item-icon">🗑</span>Delete Chat
                  </div>
                  <div className="dropdown-info-row">
                    <span className="dropdown-item-icon">{isPermanentChat ? '🔒' : '⏱'}</span>
                    <span className="dropdown-toggle-label">
                      {isPermanentChat
                        ? 'Permanent chat (MK ULTRA)'
                        : 'Messages auto-delete after 24h — get MK ULTRA for permanent chats'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="delete-chat-panel">
                  <div className="delete-chat-panel-text">
                    Both people must agree to permanently delete every message in this chat.
                  </div>
                  <div className="delete-chat-panel-status">
                    You: {deleteVotes.myVote ? '✅ Yes' : '⬜ No vote'}<br />
                    {friend.username}: {deleteVotes.otherVote ? '✅ Yes' : '⬜ No vote'}
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
        <button
          className="call-header-btn call-header-btn-right"
          onClick={() => onStartCall(friend)}
          disabled={callActive}
          title={callActive ? 'Already on a call' : `Call ${friend.username}`}
        >
          <PhoneIcon size={16} />
        </button>
      </div>

      <div className="message-list">
        {messages.map((m) => {
          const isOwn = m.username === currentUser.username;
          return (
            <div key={m.id} className={`message-row ${isOwn ? 'own' : 'friend'}`}>
              {(!isBubble || !isOwn) && (
                <Avatar username={m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={isBubble ? 32 : 40} />
              )}
              <div className="message-body">
                {(!isBubble || !isOwn) && (
                  <div className="message-header">
                    <span className="message-author">{m.username}</span>
                    <span className="message-time">{formatTime(m.createdAt)}</span>
                  </div>
                )}

                {m.replyToId && (
                  <div className="reply-reference">
                    ↩ <span className="reply-author">@{m.replyToUsername || 'unknown'}</span>{' '}
                    {truncate(m.replyToContent, 60)}
                  </div>
                )}

                {m.content && <div className="message-content">{m.content}</div>}
                {m.imageUrl && (
                  isAudioUrl(m.imageUrl) ? (
                    <audio className="message-audio" controls src={resolveAvatarUrl(m.imageUrl)} />
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
                      📄 {fileExtLabel(m.imageUrl)} file — download
                    </a>
                  )
                )}

                {isBubble && isOwn && (
                  <span className="message-time bubble-time">{formatTime(m.createdAt)}</span>
                )}

                <button
                  className="reply-btn"
                  onClick={() => setReplyTo({ id: m.id, username: m.username, content: m.content })}
                  title={t('reply')}
                >
                  ↩ {t('reply')}
                </button>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="typing-indicator">
        {typing && t('isTyping', friend.username)}
      </div>

      {replyTo && (
        <div className="reply-banner">
          {t('replyingTo')} <strong>@{replyTo.username}</strong>: {truncate(replyTo.content, 60)}
          <span className="reply-cancel" onClick={() => setReplyTo(null)}>✕</span>
        </div>
      )}

      {pendingImage && (
        <div className="pending-image-banner">
          {pendingImage.isImage ? (
            <img src={pendingImage.previewUrl} alt="pending attachment" />
          ) : (
            <span className="pending-audio-label">📎 {pendingImage.file.name}</span>
          )}
          <span className="reply-cancel" onClick={() => setPendingImage(null)}>✕</span>
        </div>
      )}

      {zoomedImage && (
        <div className="image-lightbox" onClick={() => setZoomedImage(null)}>
          <img src={zoomedImage} alt="full size" />
          <button className="image-lightbox-close" onClick={() => setZoomedImage(null)}>✕</button>
        </div>
      )}

      <form className="message-input-row" onSubmit={handleSubmit}>
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title={t('attachImage')}
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <input
          value={draft}
          onChange={handleChange}
          placeholder={t('messagePlaceholder', friend.username)}
        />
        <button type="submit" disabled={uploading}>{uploading ? t('sending') : t('send')}</button>
      </form>
    </div>
  );
}
