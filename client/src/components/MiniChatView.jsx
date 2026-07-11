import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { api } from '../api.js';
import { getSocket } from '../socket.js';

function formatTime(createdAt) {
  if (!createdAt) return '';
  const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function groupDisplayName(group, currentUserId) {
  if (group.name) return group.name;
  const others = (group.members || []).filter((m) => m.id !== currentUserId).map((m) => m.username);
  return others.length ? others.join(', ') : 'Just you';
}

// A free, flat (no channels/roles) group chat capped at 15 members. Mirrors
// MegaChatView's message-list pattern but with a single implicit "channel"
// (the group itself) and a simpler members panel -- any member can add
// another member or leave; there's no owner/kick action.
export default function MiniChatView({ group, token, currentUser, onLeft }) {
  const [members, setMembers] = useState(group.members || []);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addError, setAddError] = useState('');
  const messagesEndRef = useRef(null);

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

    function onNew({ groupId, message }) {
      if (groupId === group.id) setMessages((prev) => [...prev, message]);
    }
    function onCleared({ groupId }) {
      if (groupId === group.id) setMessages([]);
    }
    socket.on('group-message:new', onNew);
    socket.on('group-chat:cleared', onCleared);

    return () => {
      cancelled = true;
      socket.emit('group:leave', group.id);
      socket.off('group-message:new', onNew);
      socket.off('group-chat:cleared', onCleared);
    };
  }, [group.id, token]);

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

  async function handleLeave() {
    await api.leaveGroup(token, group.id, currentUser.id);
    onLeft(group.id);
  }

  const displayName = groupDisplayName({ ...group, members }, currentUser.id);
  const atCap = members.length >= 15;

  return (
    <div className="megachat-main minichat-main">
      <div className="chat-header minichat-header">
        <span className="minichat-header-name">{displayName}</span>
        <span className="megachat-footer-btn" onClick={() => setShowMembers((v) => !v)}>
          {showMembers ? 'Hide Members' : `Members (${members.length}/15)`}
        </span>
        <span className="megachat-footer-btn megachat-danger" onClick={handleLeave}>Leave</span>
      </div>

      {showMembers ? (
        <div className="megachat-members-panel">
          <form className="megachat-add-member-form" onSubmit={handleAddMember}>
            <input
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              placeholder={atCap ? 'Mini Chat is full (15/15)' : 'Add member by username'}
              maxLength={40}
              disabled={atCap}
            />
            <button type="submit" disabled={atCap}>Add</button>
          </form>
          {addError && <div className="form-error">{addError}</div>}
          <div className="megachat-members-list">
            {members.map((m) => (
              <div key={m.id} className="megachat-member-row">
                <Avatar username={m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={32} />
                <span className="megachat-member-name">
                  {m.username}
                  {m.isUltra && <span className="ultra-badge" title="MK ULTRA">ULTRA</span>}
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
                <Avatar username={m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={36} />
                <div className="megachat-message-body">
                  <div className="megachat-message-meta">
                    <span className="megachat-message-username">{m.username}</span>
                    <span className="megachat-message-time">{formatTime(m.createdAt)}</span>
                  </div>
                  <div className="megachat-message-content">{m.content}</div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form className="megachat-input-row" onSubmit={handleSend}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${displayName}`}
            />
            <button type="submit" disabled={!input.trim() || sending}>Send</button>
          </form>
        </>
      )}
    </div>
  );
}
