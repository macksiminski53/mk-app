import { useEffect, useState, useCallback } from 'react';
import AuthScreen from './components/AuthScreen.jsx';
import FriendsSidebar from './components/FriendsSidebar.jsx';
import TopBar from './components/TopBar.jsx';
import ChatArea from './components/ChatArea.jsx';
import { api } from './api.js';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import './App.css';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [activeFriendId, setActiveFriendId] = useState(null);

  const refreshFriends = useCallback(() => {
    if (!token) return;
    api.listFriends(token).then(setFriends).catch(() => {});
  }, [token]);

  const refreshRequests = useCallback(() => {
    if (!token) return;
    api.listRequests(token).then(setRequests).catch(() => {});
  }, [token]);

  const refreshSelf = useCallback(() => {
    if (!token) return;
    api.getMe(token).then((fresh) => {
      setUser((prev) => {
        const updated = { ...prev, ...fresh };
        localStorage.setItem('user', JSON.stringify(updated));
        return updated;
      });
    }).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    connectSocket(token);
    refreshFriends();
    refreshRequests();

    const socket = getSocket();
    function onPresence({ userId, online }) {
      setFriends((prev) => prev.map((f) => (f.id === userId ? { ...f, online } : f)));
    }
    function onRequestReceived() {
      refreshRequests();
    }
    function onProfileChanged({ self }) {
      if (self) refreshSelf();
      else refreshFriends();
    }
    socket.on('presence:update', onPresence);
    socket.on('friend:request-received', onRequestReceived);
    socket.on('profile:changed', onProfileChanged);

    return () => {
      socket.off('presence:update', onPresence);
      socket.off('friend:request-received', onRequestReceived);
      socket.off('profile:changed', onProfileChanged);
      disconnectSocket();
    };
  }, [token]);

  const handleAuthed = useCallback((tok, usr) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('user', JSON.stringify(usr));
    setToken(tok);
    setUser(usr);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    disconnectSocket();
    setToken(null);
    setUser(null);
    setFriends([]);
    setRequests([]);
    setActiveFriendId(null);
  }, []);

  async function handleSendFriendRequest(username) {
    const res = await api.sendFriendRequest(token, username);
    getSocket().emit('friend:request-sent', res.targetId);
    if (res.autoAccepted) refreshFriends();
  }

  async function handleRespond(requestId, accept) {
    const res = await api.respondToRequest(token, requestId, accept);
    refreshRequests();
    if (accept) {
      refreshFriends();
      getSocket().emit('friend:request-sent', res.fromId);
    }
  }

  async function handleRemoveFriend(friendId) {
    await api.removeFriend(token, friendId);
    setFriends((prev) => prev.filter((f) => f.id !== friendId));
    if (activeFriendId === friendId) setActiveFriendId(null);
  }

  async function handleChangeAvatar(file) {
    const res = await api.uploadAvatar(token, file);
    setUser((prev) => {
      const updated = { ...prev, avatarUrl: res.avatarUrl };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  async function handleSetStatus(statusText) {
    const res = await api.setStatus(token, statusText);
    setUser((prev) => {
      const updated = { ...prev, statusText: res.statusText };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  if (!token || !user) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  const activeFriend = friends.find((f) => f.id === activeFriendId) || null;

  return (
    <div className="app-root">
      <TopBar
        requests={requests}
        onRefreshRequests={refreshRequests}
        onRespond={handleRespond}
        onSendRequest={handleSendFriendRequest}
      />
      <div className="app-shell">
        <FriendsSidebar
          friends={friends}
          activeFriendId={activeFriendId}
          onSelect={(f) => setActiveFriendId(f.id)}
          currentUser={user}
          onLogout={handleLogout}
          onChangeAvatar={handleChangeAvatar}
          onSetStatus={handleSetStatus}
        />
        <ChatArea
          token={token}
          friend={activeFriend}
          currentUser={user}
          onRemoveFriend={handleRemoveFriend}
        />
      </div>
    </div>
  );
}
