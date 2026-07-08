import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import Avatar from './Avatar.jsx';

function formatTime(iso) {
  const d = new Date(iso + 'Z');
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ChatArea({ token, friend, currentUser, onRemoveFriend }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);

  const threadId = friend?.threadId;

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setMessages([]);
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

  function handleSubmit(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    getSocket().emit('message:send', { threadId, content: draft.trim() }, (res) => {
      if (res?.error) console.error(res.error);
    });
    setDraft('');
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
        {messages.map((m) => {
          const mine = m.username === currentUser.username;
          return (
            <div key={m.id} className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
              {!mine && (
                <Avatar username={m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={28} className="small" />
              )}
              <div className={`bubble ${mine ? 'bubble-mine' : 'bubble-theirs'}`}>
                <div className="bubble-content">{m.content}</div>
                <div className="bubble-time">{formatTime(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="typing-indicator">
        {typing && `${friend.username} is typing…`}
      </div>

      <form className="message-input-row" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={handleChange}
          placeholder={`Message ${friend.username}`}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
