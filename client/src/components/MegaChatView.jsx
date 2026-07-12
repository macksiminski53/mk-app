import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import EmojiPicker, { renderWithCustomEmoji } from './EmojiPicker.jsx';
import LikeButton from './LikeButton.jsx';
import PinButton from './PinButton.jsx';
import { BackIcon, PinIcon } from './Icons.jsx';
import PinnedPanel from './PinnedPanel.jsx';

function formatTime(createdAt) {
  if (!createdAt) return '';
  const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Channel sidebar + message area for one Mega Chat (a paid, Discord-style
// server). Mirrors ChatArea's basic message-list pattern but scoped to a
// channel room over the socket instead of a DM thread.
export default function MegaChatView({ server, token, currentUser, onLeftOrDeleted, onRename, onBack }) {
  const [detail, setDetail] = useState(null);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addError, setAddError] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  // Mobile only: which of the two panes (channel list, or the active
  // channel's chat) is showing -- desktop CSS ignores these classes and
  // always shows both side by side.
  const [mobileShowChannels, setMobileShowChannels] = useState(true);
  const messagesEndRef = useRef(null);
  const activeChannelIdRef = useRef(null);
  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);

  const isOwner = detail?.ownerId === currentUser.id;

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setMessages([]);
    api.getServer(token, server.id).then((d) => {
      if (cancelled) return;
      setDetail(d);
      setActiveChannelId((prev) => (d.channels.find((c) => c.id === prev) ? prev : d.channels[0]?.id ?? null));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [server.id, token]);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
    if (!activeChannelId) return;
    let cancelled = false;
    const socket = getSocket();
    socket.emit('channel:join', activeChannelId);
    api.listChannelMessages(token, server.id, activeChannelId).then((rows) => {
      if (!cancelled) setMessages(rows);
    }).catch(() => {});
    setPinnedMessages([]);
    api.listPinnedChannel(token, server.id, activeChannelId).then((rows) => {
      if (!cancelled) setPinnedMessages(rows);
    }).catch(() => {});

    function onNew({ channelId, message }) {
      if (channelId === activeChannelIdRef.current) {
        setMessages((prev) => [...prev, message]);
      }
    }
    function onLikeUpdate({ messageType, messageId, likeCount }) {
      if (messageType !== 'mega') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, likeCount } : m)));
    }
    function onPinUpdate({ messageType, messageId, pinned, pinnedByUsername }) {
      if (messageType !== 'mega') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pinned, pinnedByUsername: pinned ? pinnedByUsername : null } : m)));
      setPinnedMessages((prev) => {
        if (!pinned) return prev.filter((m) => m.id !== messageId);
        if (prev.some((m) => m.id === messageId)) return prev;
        const source = messagesRef.current.find((m) => m.id === messageId);
        return source ? [...prev, source] : prev;
      });
    }
    socket.on('channel-message:new', onNew);
    socket.on('message:like-update', onLikeUpdate);
    socket.on('message:pin-update', onPinUpdate);

    return () => {
      cancelled = true;
      socket.emit('channel:leave', activeChannelId);
      socket.off('channel-message:new', onNew);
      socket.off('message:like-update', onLikeUpdate);
      socket.off('message:pin-update', onPinUpdate);
    };
  }, [activeChannelId, server.id, token]);

  function toggleLike(messageId) {
    getSocket().emit('message:like', { messageType: 'mega', messageId, roomId: activeChannelId }, (res) => {
      if (res?.error) return console.error(res.error);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, likeCount: res.likeCount, likedByMe: res.likedByMe } : m)));
    });
  }

  function togglePin(messageId) {
    getSocket().emit('message:pin', { messageType: 'mega', messageId, roomId: activeChannelId }, (res) => {
      if (res?.error) return console.error(res.error);
    });
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || !activeChannelId || sending) return;
    setSending(true);
    getSocket().emit('channel-message:send', { channelId: activeChannelId, content: trimmed }, (ack) => {
      setSending(false);
      if (ack?.ok) setInput('');
    });
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const clean = addUsername.trim();
    if (!clean) return;
    try {
      const member = await api.addServerMember(token, server.id, clean);
      setDetail((prev) => (prev ? { ...prev, members: [...prev.members, member].sort((a, b) => a.username.localeCompare(b.username)) } : prev));
      setAddUsername('');
      setAddError('');
    } catch (err) {
      setAddError(err.message || 'Failed to add member');
    }
  }

  async function handleRemoveMember(userId) {
    await api.removeServerMember(token, server.id, userId);
    setDetail((prev) => (prev ? { ...prev, members: prev.members.filter((m) => m.id !== userId) } : prev));
  }

  async function handleLeave() {
    await api.removeServerMember(token, server.id, currentUser.id);
    onLeftOrDeleted(server.id);
  }

  async function handleDeleteServer() {
    await api.deleteServer(token, server.id);
    onLeftOrDeleted(server.id);
  }

  async function handleCreateChannel(e) {
    e.preventDefault();
    const clean = newChannelName.trim();
    if (!clean) return;
    const channel = await api.createChannel(token, server.id, clean);
    setDetail((prev) => (prev ? { ...prev, channels: [...prev.channels, channel] } : prev));
    setNewChannelName('');
    setShowNewChannel(false);
    setActiveChannelId(channel.id);
  }

  async function handleDeleteChannel(channelId) {
    if (!detail || detail.channels.length <= 1) return;
    await api.deleteChannel(token, server.id, channelId);
    setDetail((prev) => {
      const channels = prev.channels.filter((c) => c.id !== channelId);
      return { ...prev, channels };
    });
    if (activeChannelId === channelId) {
      setActiveChannelId(detail.channels.find((c) => c.id !== channelId)?.id ?? null);
    }
  }

  const activeChannel = detail?.channels.find((c) => c.id === activeChannelId) || null;

  return (
    <div className={`megachat-view ${mobileShowChannels ? 'mobile-show-channels' : 'mobile-show-chat'}`}>
      <div className="megachat-channels">
        <div className="megachat-server-header">
          {onBack && (
            <button type="button" className="mobile-back-btn" onClick={onBack} title="Back">
              <BackIcon />
            </button>
          )}
          <span>{server.name}</span>
        </div>
        <div className="megachat-channel-list">
          {(detail?.channels || []).map((c) => (
            <div
              key={c.id}
              className={`megachat-channel-row ${activeChannelId === c.id ? 'active' : ''}`}
              onClick={() => { setActiveChannelId(c.id); setMobileShowChannels(false); }}
            >
              <span className="megachat-channel-hash">#</span>
              <span className="megachat-channel-name">{c.name}</span>
              {isOwner && detail.channels.length > 1 && (
                <span
                  className="megachat-channel-delete"
                  onClick={(e) => { e.stopPropagation(); handleDeleteChannel(c.id); }}
                  title="Delete channel"
                >
                  Remove
                </span>
              )}
            </div>
          ))}
          {isOwner && (
            showNewChannel ? (
              <form className="megachat-new-channel-form" onSubmit={handleCreateChannel}>
                <input
                  autoFocus
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  onBlur={() => { if (!newChannelName.trim()) setShowNewChannel(false); }}
                  placeholder="new-channel"
                  maxLength={40}
                />
              </form>
            ) : (
              <div className="megachat-channel-row megachat-add-channel" onClick={() => setShowNewChannel(true)}>
                + Add Channel
              </div>
            )
          )}
        </div>

        <div className="megachat-sidebar-footer">
          <div className="megachat-footer-btn" onClick={() => setShowMembers((v) => !v)}>
            {showMembers ? 'Hide Members' : `Members (${detail?.members?.length ?? '…'})`}
          </div>
          <div className="megachat-footer-btn" onClick={() => setShowPinnedPanel(true)}>
            <PinIcon size={12} /> Pinned ({pinnedMessages.length}/10)
          </div>
          {isOwner ? (
            <div className="megachat-footer-btn megachat-danger" onClick={handleDeleteServer}>Delete Mega Chat</div>
          ) : (
            <div className="megachat-footer-btn megachat-danger" onClick={handleLeave}>Leave</div>
          )}
        </div>
      </div>

      <div className="megachat-main">
        <div className="megachat-mobile-header">
          <button type="button" className="mobile-back-btn" onClick={() => setMobileShowChannels(true)} title="Back to channels">
            <BackIcon />
          </button>
          <span className="megachat-mobile-channel-name">{activeChannel ? `#${activeChannel.name}` : server.name}</span>
        </div>
        {showMembers ? (
          <div className="megachat-members-panel">
            <form className="megachat-add-member-form" onSubmit={handleAddMember}>
              <input
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                placeholder="Add member by username"
                maxLength={40}
              />
              <button type="submit">Add</button>
            </form>
            {addError && <div className="form-error">{addError}</div>}
            <div className="megachat-members-list">
              {(detail?.members || []).map((m) => (
                <div key={m.id} className="megachat-member-row">
                  <Avatar username={m.displayName || m.username} avatarColor={m.avatarColor} avatarUrl={m.avatarUrl} size={32} ultraBorder={m.isUltra} />
                  <span className="megachat-member-name">
                    {m.displayName || m.username}
                    {m.id === detail.ownerId && <span className="ultra-badge" title="Owner">OWNER</span>}
                    {m.isUltra && <span className="ultra-badge" title="MK ULTRA">ULTRA</span>}
                    {!m.isUltra && m.isPremium && <span className="premium-badge" title="MK PREMIUM">PREMIUM</span>}
                    {!m.isUltra && !m.isPremium && m.isPlus && <span className="plus-badge" title="MK PLUS">PLUS</span>}
                  </span>
                  {isOwner && m.id !== detail.ownerId && (
                    <span className="megachat-member-kick" onClick={() => handleRemoveMember(m.id)}>Remove</span>
                  )}
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
                    <div className="megachat-message-content">{renderWithCustomEmoji(m.content, m.customEmojiUrl)}</div>
                    <div className="message-actions-row">
                      <LikeButton
                        likeCount={m.likeCount}
                        likedByMe={m.likedByMe}
                        canLike={!!currentUser?.isPremium}
                        onToggle={() => toggleLike(m.id)}
                      />
                      <PinButton pinned={!!m.pinned} onToggle={() => togglePin(m.id)} />
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form className="megachat-input-row" onSubmit={handleSend}>
              {currentUser?.isPremium && (
                <EmojiPicker onSelect={(emoji) => setInput((prev) => prev + emoji)} customEmojiUrl={currentUser?.customEmojiUrl} />
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={activeChannel ? `Message #${activeChannel.name}` : 'Select a channel'}
                disabled={!activeChannelId}
              />
              <button type="submit" disabled={!input.trim() || !activeChannelId || sending}>Send</button>
            </form>
          </>
        )}
      </div>

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
