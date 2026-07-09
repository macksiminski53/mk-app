import { useEffect, useRef, useState, useCallback } from 'react';
import AuthScreen from './components/AuthScreen.jsx';
import FriendsSidebar from './components/FriendsSidebar.jsx';
import TopBar from './components/TopBar.jsx';
import ChatArea from './components/ChatArea.jsx';
import CallBar from './components/CallBar.jsx';
import { api } from './api.js';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import { getTranslator } from './i18n.js';
import { createPeerConnection, getMicStream, stopStream } from './webrtc.js';
import './App.css';

const DEFAULT_SETTINGS = { language: 'en', chatLayout: 'bubble' };

function loadSettings() {
  try {
    const raw = localStorage.getItem('mk-settings');
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [activeFriendId, setActiveFriendId] = useState(null);
  const [settings, setSettings] = useState(loadSettings);

  // --- Voice call state ---
  // call is one of: null | { status: 'incoming', fromUserId, fromUsername, fromAvatarColor, fromAvatarUrl }
  //               | { status: 'outgoing', friend }
  //               | { status: 'active', friend, startedAt }
  const [call, setCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const remoteUserIdRef = useRef(null);
  const iceQueueRef = useRef([]);

  const t = getTranslator(settings.language);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const updated = { ...prev, ...patch };
      localStorage.setItem('mk-settings', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Kept in sync with `friends` so the call:incoming socket handler (set up
  // once per token, not re-bound on every friends-list change) can still
  // look up the caller's avatar without becoming stale.
  const friendsRef = useRef([]);
  useEffect(() => { friendsRef.current = friends; }, [friends]);

  const cleanupCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    remoteUserIdRef.current = null;
    iceQueueRef.current = [];
    setMuted(false);
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);
  const cleanupCallRef = useRef(cleanupCall);
  useEffect(() => { cleanupCallRef.current = cleanupCall; }, [cleanupCall]);

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

    // --- Call signaling ---
    function onCallIncoming({ fromUserId, fromUsername }) {
      // Already on a call (or ringing someone) -- silently ignore a second
      // incoming call rather than trying to juggle two at once.
      setCall((prev) => {
        if (prev) return prev;
        const fromFriend = friendsRef.current.find((f) => f.id === fromUserId);
        return {
          status: 'incoming',
          fromUserId,
          fromUsername,
          fromAvatarColor: fromFriend?.avatarColor,
          fromAvatarUrl: fromFriend?.avatarUrl,
        };
      });
    }

    async function onCallAccepted({ fromUserId }) {
      // We were the caller; the other side just accepted. Build the offer
      // now and send it their way.
      const pc = pcRef.current;
      if (!pc) return;
      remoteUserIdRef.current = fromUserId;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      getSocket().emit('call:signal', { toUserId: fromUserId, data: { type: 'offer', sdp: offer } });
      setCall((prev) => (prev && prev.status === 'outgoing' ? { status: 'active', friend: prev.friend, startedAt: Date.now() } : prev));
    }

    function onCallDeclined() {
      cleanupCallRef.current();
      setCall(null);
    }

    function onCallEnded() {
      cleanupCallRef.current();
      setCall(null);
    }

    async function onCallSignal({ fromUserId, data }) {
      let pc = pcRef.current;
      if (data.type === 'offer') {
        // We're the callee and just accepted; pc should already exist
        // (created in handleAcceptCall) with local tracks attached.
        if (!pc) return;
        remoteUserIdRef.current = fromUserId;
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        for (const c of iceQueueRef.current) await pc.addIceCandidate(c).catch(() => {});
        iceQueueRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        getSocket().emit('call:signal', { toUserId: fromUserId, data: { type: 'answer', sdp: answer } });
      } else if (data.type === 'answer') {
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        for (const c of iceQueueRef.current) await pc.addIceCandidate(c).catch(() => {});
        iceQueueRef.current = [];
      } else if (data.type === 'candidate') {
        const candidate = new RTCIceCandidate(data.candidate);
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(candidate).catch(() => {});
        } else {
          iceQueueRef.current.push(candidate);
        }
      }
    }

    socket.on('presence:update', onPresence);
    socket.on('friend:request-received', onRequestReceived);
    socket.on('profile:changed', onProfileChanged);
    socket.on('call:incoming', onCallIncoming);
    socket.on('call:accepted', onCallAccepted);
    socket.on('call:declined', onCallDeclined);
    socket.on('call:ended', onCallEnded);
    socket.on('call:signal', onCallSignal);

    return () => {
      socket.off('presence:update', onPresence);
      socket.off('friend:request-received', onRequestReceived);
      socket.off('profile:changed', onProfileChanged);
      socket.off('call:incoming', onCallIncoming);
      socket.off('call:accepted', onCallAccepted);
      socket.off('call:declined', onCallDeclined);
      socket.off('call:ended', onCallEnded);
      socket.off('call:signal', onCallSignal);
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

  async function handleSetBio(bio) {
    const res = await api.setBio(token, bio);
    setUser((prev) => {
      const updated = { ...prev, bio: res.bio };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  function setupPeerConnection(toUserId) {
    const pc = createPeerConnection({
      onIceCandidate: (candidate) => {
        getSocket().emit('call:signal', { toUserId, data: { type: 'candidate', candidate } });
      },
      onTrack: (stream) => {
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      },
      onConnectionStateChange: (state) => {
        if (state === 'failed' || state === 'closed') {
          cleanupCall();
          setCall(null);
        }
      },
    });
    localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
    pcRef.current = pc;
    return pc;
  }

  async function handleStartCall(friend) {
    if (call) return; // already on/making a call
    try {
      localStreamRef.current = await getMicStream();
    } catch (err) {
      console.error('Microphone access denied or unavailable:', err.message);
      return;
    }
    setupPeerConnection(friend.id);
    remoteUserIdRef.current = friend.id;
    getSocket().emit('call:invite', { toUserId: friend.id });
    setCall({ status: 'outgoing', friend });
  }

  async function handleAcceptCall() {
    if (!call || call.status !== 'incoming') return;
    const { fromUserId, fromUsername, fromAvatarColor, fromAvatarUrl } = call;
    try {
      localStreamRef.current = await getMicStream();
    } catch (err) {
      console.error('Microphone access denied or unavailable:', err.message);
      getSocket().emit('call:decline', { toUserId: fromUserId });
      setCall(null);
      return;
    }
    setupPeerConnection(fromUserId);
    remoteUserIdRef.current = fromUserId;
    getSocket().emit('call:accept', { toUserId: fromUserId });
    const friend = friends.find((f) => f.id === fromUserId) || {
      id: fromUserId,
      username: fromUsername,
      avatarColor: fromAvatarColor,
      avatarUrl: fromAvatarUrl,
    };
    setCall({ status: 'active', friend, startedAt: Date.now() });
  }

  function handleDeclineCall() {
    if (!call || call.status !== 'incoming') return;
    getSocket().emit('call:decline', { toUserId: call.fromUserId });
    setCall(null);
  }

  function handleEndOrCancelCall() {
    const toUserId = remoteUserIdRef.current;
    if (toUserId) getSocket().emit('call:end', { toUserId });
    cleanupCall();
    setCall(null);
  }

  function handleToggleMute() {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
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
        settings={settings}
        onUpdateSettings={updateSettings}
        onLogout={handleLogout}
        t={t}
      />
      {call && (
        <CallBar
          call={call}
          muted={muted}
          onAccept={handleAcceptCall}
          onDecline={handleDeclineCall}
          onCancel={handleEndOrCancelCall}
          onHangUp={handleEndOrCancelCall}
          onToggleMute={handleToggleMute}
        />
      )}
      <audio ref={remoteAudioRef} autoPlay />
      <div className="app-shell">
        <FriendsSidebar
          friends={friends}
          activeFriendId={activeFriendId}
          onSelect={(f) => setActiveFriendId(f.id)}
          currentUser={user}
          onLogout={handleLogout}
          onChangeAvatar={handleChangeAvatar}
          onSetStatus={handleSetStatus}
          onSetBio={handleSetBio}
        />
        <ChatArea
          token={token}
          friend={activeFriend}
          currentUser={user}
          onRemoveFriend={handleRemoveFriend}
          onStartCall={handleStartCall}
          callActive={!!call}
          chatLayout={settings.chatLayout}
          t={t}
        />
      </div>
    </div>
  );
}
