import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
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
import MessageContextMenu from './MessageContextMenu.jsx';
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
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [contextMenu, setContextMenu] = useState(null); // { message, x, y }

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
    function onCleared({ channelId }) {
      if (channelId === activeChannelIdRef.current) setMessages([]);
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
    function onReactionsUpdate({ messageType, messageId, reactions }) {
      if (messageType !== 'mega') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
    }
    function onEditUpdate({ messageType, messageId, content, editedAt }) {
      if (messageType !== 'mega') return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content, editedAt } : m)));
    }
    // An admin deleted this message via the admin panel/context menu --
    // remove it from local state for everyone currently viewing the channel.
    function onMessageDeleted({ messageType, messageId }) {
      if (messageType !== 'mega') return;
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    }
    socket.on('channel-message:new', onNew);
    socket.on('channel-message:cleared', onCleared);
    socket.on('message:like-update', onLikeUpdate);
    socket.on('message:pin-update', onPinUpdate);
    socket.on('message:reactions-update', onReactionsUpdate);
    socket.on('message:edit-update', onEditUpdate);
    socket.on('message:deleted', onMessageDeleted);

    return () => {
      cancelled = true;
      socket.emit('channel:leave', activeChannelId);
      socket.off('channel-message:new', onNew);
      socket.off('channel-message:cleared', onCleared);
      socket.off('message:like-update', onLikeUpdate);
      socket.off('message:pin-update', onPinUpdate);
      socket.off('message:reactions-update', onReactionsUpdate);
      socket.off('message:edit-update', onEditUpdate);
      socket.off('message:deleted', onMessageDeleted);
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

  function toggleReaction(messageId, emoji) {
    getSocket().emit('message:react', { messageType: 'mega', messageId, roomId: activeChannelId, emoji }, (res) => {
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
    getSocket().emit('message:edit', { messageType: 'mega', messageId, roomId: activeChannelId, content: trimmed }, (res) => {
      if (res?.error) return console.error(res.error);
      cancelEdit();
    });
  }

  // Admin-only: deletes any message regardless of author, via the REST API
  // (server/routes/admin.js) rather than the normal socket path -- the
  // resulting broadcast still arrives over the socket as 'message:deleted'.
  function adminDeleteMessage(messageId) {
    api.adminDeleteMessage(token, 'mega', messageId, activeChannelId).catch((err) => console.error(err.message));
  }

  function pickMention(username) {
    setInput((prev) => applyMentionPick(prev, username));
  }

  function openContextMenu(e, m) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 170);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    setContextMenu({ message: m, x, y });
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

  function sendGif(url) {
    if (!activeChannelId) return;
    getSocket().emit('channel-message:send', { channelId: activeChannelId, content: '', imageUrl: url }, (ack) => {
      if (ack?.error) console.error(ack.error);
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
  const mentionQuery = getMentionQuery(input);
  const mentionCandidates = detail?.members || [];

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
                  <Avatar username={m.displayName || m.username} avatarColor={m.avatarColor} avatarIcon={m.avatarIcon} avatarUrl={m.avatarUrl} size={32} ultraBorder={m.isUltra} />
                  <span className="megachat-member-name">
                    {m.displayName || m.username}
                    {m.id === detail.ownerId && <span className="ultra-badge" title="Owner">OWNER</span>}
                    {m.isAdmin && <span className="admin-badge" title="MK Admin">ADMIN</span>}
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
                <div key={m.id} className="megachat-message-row" onContextMenu={(e) => openContextMenu(e, m)}>
                  <Avatar username={m.displayName || m.username} avatarColor={m.avatarColor} avatarIcon={m.avatarIcon} avatarUrl={m.avatarUrl} size={36} ultraBorder={m.isUltra} />
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
                  placeholder={activeChannel ? `Message #${activeChannel.name}` : 'Select a channel'}
                  disabled={!activeChannelId}
                />
              </div>
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

      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canEdit={contextMenu.message.userId === currentUser.id && !!contextMenu.message.content}
          pinned={!!contextMenu.message.pinned}
          onEdit={() => startEdit(contextMenu.message)}
          onReact={(emoji) => toggleReaction(contextMenu.message.id, emoji)}
          onPin={() => togglePin(contextMenu.message.id)}
          onAdminDelete={currentUser?.isAdmin ? () => adminDeleteMessage(contextMenu.message.id) : null}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
