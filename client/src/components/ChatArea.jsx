import { useEffect, useRef, useState } from 'react';
import { api, resolveAvatarUrl } from '../api.js';
import { getSocket } from '../socket.js';
import Avatar from './Avatar.jsx';

function formatTime(iso) {
  const d = new Date(iso + 'Z');
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function truncate(text, max = 80) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export default function ChatArea({ token, friend, currentUser, onRemoveFriend }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // { id, username, content }
  const [pendingImage, setPendingImage] = useState(null); // { file, previewUrl }
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const fileInputRef = useRef(null);

  const threadId = friend?.threadId;

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setMessages([]);
    setReplyTo(null);
    setPendingImage(null);
    api.listMessages(token, threadId).then((msgs) => {
      if (!cancelled) setMessages(msgs);
    });

    const socket = getSocket();
    socket.emit('thread:join', threadId);

    function onNewMessage({ threadId: tid, message }) {
      if (tid === threadId) setMessages((prev) => [...prev, message]);
    }
    function onTyping({ threadId: tid, username, isTyping }) {
      if (tid !== threadId || username === currentUser.username) return;
      setTyping(isTyping);
    }

    socket.on('message:new', onNewMessage);
    socket.on('typing', onTyping);

    return () => {
      cancelled = true;
      socket.emit('thread:leave', threadId);
      socket.off('message:new', onNewMessage);
      socket.off('typing', onTyping);
    };
  }, [threadId]);

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
    setPendingImage({ file, previewUrl: URL.createObjectURL(file) });
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
    return <div className="chat-area empty">Select a friend to start chatting.</div>;
  }

  return (
    <div className="chat-area">
      <div className="chat-header">
        <span className="chat-header-name">{friend.username}</span>
        <span className={`chat-header-status ${friend.online ? 'online' : ''}`}>
          {friend.online ? 'Online' : 'Offline'}
        </span>
        <div className="dropdown-wrap chat-settings-wrap">
          <span className="gear-icon" onClick={() => setShowSettings((v) => !v)} title="Chat settings">⚙</span>
          {showSettings && (
            <div className="dropdown-menu right" onMouseLeave={() => setShowSettings(false)}>
              <div
                className="dropdown-item danger"
                onClick={() => {
                  setShowSettings(false);
                  onRemoveFriend(friend.id);
                }}
              >
                Remove Friend
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="message-list">
        {messages.map((m) => (
          <div key={m.id} className="message-row">
            <Avatar username={m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={40} />
            <div className="message-body">
              <div className="message-header">
                <span className="message-author">{m.username}</span>
                <span className="message-time">{formatTime(m.createdAt)}</span>
              </div>

              {m.replyToId && (
                <div className="reply-reference">
                  ↩ <span className="reply-author">@{m.replyToUsername || 'unknown'}</span>{' '}
                  {truncate(m.replyToContent, 60)}
                </div>
              )}

              {m.content && <div className="message-content">{m.content}</div>}
              {m.imageUrl && (
                <img
                  className="message-image"
                  src={resolveAvatarUrl(m.imageUrl)}
                  alt="attachment"
                />
              )}

              <button
                className="reply-btn"
                onClick={() => setReplyTo({ id: m.id, username: m.username, content: m.content })}
                title="Reply"
              >
                ↩ Reply
              </button>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="typing-indicator">
        {typing && `${friend.username} is typing…`}
      </div>

      {replyTo && (
        <div className="reply-banner">
          Replying to <strong>@{replyTo.username}</strong>: {truncate(replyTo.content, 60)}
          <span className="reply-cancel" onClick={() => setReplyTo(null)}>✕</span>
        </div>
      )}

      {pendingImage && (
        <div className="pending-image-banner">
          <img src={pendingImage.previewUrl} alt="pending attachment" />
          <span className="reply-cancel" onClick={() => setPendingImage(null)}>✕</span>
        </div>
      )}

      <form className="message-input-row" onSubmit={handleSubmit}>
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach an image"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <input
          value={draft}
          onChange={handleChange}
          placeholder={`Message ${friend.username}`}
        />
        <button type="submit" disabled={uploading}>{uploading ? 'Sending…' : 'Send'}</button>
      </form>
    </div>
  );
}
