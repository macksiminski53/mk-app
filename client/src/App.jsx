import { useEffect, useRef, useState, useCallback } from 'react';
import AuthScreen from './components/AuthScreen.jsx';
import FriendsSidebar from './components/FriendsSidebar.jsx';
import TopBar from './components/TopBar.jsx';
import ChatArea from './components/ChatArea.jsx';
import CallBar from './components/CallBar.jsx';
import ActiveCallView from './components/ActiveCallView.jsx';
import ServerRail from './components/ServerRail.jsx';
import MegaChatView from './components/MegaChatView.jsx';
import MiniChatView from './components/MiniChatView.jsx';
import { api, setUnauthorizedHandler } from './api.js';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import { getTranslator } from './i18n.js';
import { createPeerConnection, getMicStream, getCamStream, getScreenStream, stopStream } from './webrtc.js';
import { playMessageChime } from './notifySound.js';
import './App.css';

const DEFAULT_SETTINGS = { language: 'en', chatLayout: 'bubble', micDeviceId: '', speakerDeviceId: '', customAccent: '' };

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
  // Set by the 401 handler registered below -- shows a "please log back
  // in" banner on the next AuthScreen render instead of the user just
  // silently landing back on the login form with no explanation.
  const [sessionExpired, setSessionExpired] = useState(false);
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [activeFriendId, setActiveFriendId] = useState(null);
  const [servers, setServers] = useState([]);
  const [activeServerId, setActiveServerId] = useState(null);
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [settings, setSettings] = useState(loadSettings);
  const [chatSettingsTrigger, setChatSettingsTrigger] = useState(0);
  const [megaChatCreateTrigger, setMegaChatCreateTrigger] = useState(0);
  const [miniChatCreateTrigger, setMiniChatCreateTrigger] = useState(0);
  const [billingConfigured, setBillingConfigured] = useState(null); // null = unknown yet

  // --- Voice call state ---
  // call is one of: null | { status: 'incoming', fromUserId, fromUsername, fromAvatarColor, fromAvatarUrl }
  //               | { status: 'outgoing', friend }
  //               | { status: 'active', friend, startedAt }
  const [call, setCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const remoteUserIdRef = useRef(null);
  const iceQueueRef = useRef([]);
  // Video is added on demand mid-call (not upfront with the mic), so it
  // gets its own refs: the RTCRtpSender from the first addTrack (reused via
  // replaceTrack for every toggle after that -- see handleToggleCamera),
  // the raw camera MediaStream (so its device can be released on toggle-off
  // and re-acquired fresh next time), and the two <video> elements.
  const camSenderRef = useRef(null);
  const camStreamRef = useRef(null);
  // Screen share reuses camSenderRef/its m-line (see handleToggleScreenShare)
  // since camera and screen share are just two possible sources for the
  // same "local video" slot -- only ever one active at a time -- so it only
  // needs its own stream ref, not a separate sender.
  const screenStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteVideoStreamRef = useRef(null);

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

  // Same staleness problem as friendsRef, for the notify:message handler
  // below to know whether the sender's chat is the one currently open
  // (skip the notification/chime if so -- the message is already visible).
  const activeFriendIdRef = useRef(null);
  useEffect(() => { activeFriendIdRef.current = activeFriendId; }, [activeFriendId]);

  // Ask for OS notification permission once we know who's logged in. Safe
  // to call repeatedly -- the browser only ever prompts the user once and
  // just returns the cached answer on subsequent calls.
  useEffect(() => {
    if (token && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [token]);

  const cleanupCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    stopStream(camStreamRef.current);
    camStreamRef.current = null;
    stopStream(screenStreamRef.current);
    screenStreamRef.current = null;
    camSenderRef.current = null;
    remoteVideoStreamRef.current = null;
    remoteUserIdRef.current = null;
    iceQueueRef.current = [];
    setMuted(false);
    setCameraOn(false);
    setScreenSharing(false);
    setRemoteHasVideo(false);
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
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

  const refreshServers = useCallback(() => {
    if (!token) return;
    api.listServers(token).then(setServers).catch(() => {});
  }, [token]);

  const refreshGroups = useCallback(() => {
    if (!token) return;
    api.listGroups(token).then(setGroups).catch(() => {});
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

  // Lets Settings show "payments aren't set up yet" instead of a button
  // that silently fails when STRIPE_PAYMENT_LINK / STRIPE_SECRET_KEY isn't
  // configured on the server yet.
  useEffect(() => {
    if (!token) return;
    api.getBillingStatus(token).then((s) => setBillingConfigured(s.configured)).catch(() => setBillingConfigured(false));
  }, [token]);

  // Accent color: MK PLUS's account-level color (synced across devices,
  // also available to MK ULTRA since ULTRA includes every PLUS perk) takes
  // priority when set; otherwise falls back to the free, local-only pick
  // from Extra > Accent Color (just a client preference, not stored on the
  // account -- available to everyone, not just PLUS/ULTRA). Applied as a
  // CSS variable rather than touching every element's color individually.
  useEffect(() => {
    const color = (user?.isPlus && user?.ultraColor) ? user.ultraColor : settings.customAccent;
    if (color) {
      document.documentElement.style.setProperty('--mk-accent', color);
    } else {
      document.documentElement.style.removeProperty('--mk-accent');
    }
  }, [user?.isPlus, user?.ultraColor, settings.customAccent]);

  // Voice Chat > output device: <audio> has no JSX attribute for this, it's
  // an imperative-only API (setSinkId), and only Chromium browsers support
  // it -- Firefox/Safari just silently keep using the system default, which
  // is fine as a graceful fallback.
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (el && settings.speakerDeviceId && typeof el.setSinkId === 'function') {
      el.setSinkId(settings.speakerDeviceId).catch((err) => {
        console.error('Failed to set audio output device:', err.message);
      });
    }
  }, [settings.speakerDeviceId, call?.status]);

  // The <video> elements for local/remote camera feeds are only mounted in
  // the DOM once cameraOn/remoteHasVideo flips true (see CallBar.jsx) -- but
  // that state update and the code that wants to attach a MediaStream to
  // the element both originate from the same onTrack/handleToggleCamera
  // callback, which runs *before* React has actually mounted the element.
  // Assigning `.srcObject` there was a no-op (the ref was still null) and
  // the video just stayed black forever after. These effects re-run once
  // the state change has actually been committed and the element exists,
  // which is the reliable place to do this assignment.
  useEffect(() => {
    if (remoteHasVideo && remoteVideoRef.current && remoteVideoStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteVideoStreamRef.current;
    }
  }, [remoteHasVideo]);

  useEffect(() => {
    if (cameraOn && localVideoRef.current && camStreamRef.current) {
      localVideoRef.current.srcObject = camStreamRef.current;
    }
  }, [cameraOn]);

  // After returning from Stripe Checkout (?ultra=success in the URL),
  // refresh the user so the newly-granted isUltra flag shows up, then
  // clean the query param out of the address bar.
  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('ultra')) {
      if (params.get('ultra') === 'success') refreshSelf();
      params.delete('ultra');
      const next = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : ''));
    }
  }, [token, refreshSelf]);

  // Same pattern as ?ultra=success above, for returning from a Mega Chat
  // purchase. The actual server row is created by the Stripe webhook (which
  // may land slightly after this redirect), so the megachat:ready socket
  // event below is what actually adds it to the list -- this just cleans up
  // the URL and does a refetch as a safety net in case the socket event was
  // missed (e.g. tab was backgrounded).
  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('megachat')) {
      if (params.get('megachat') === 'success') refreshServers();
      params.delete('megachat');
      const next = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : ''));
    }
  }, [token, refreshServers]);

  useEffect(() => {
    if (!token) return;
    connectSocket(token);
    // Reconciles the locally-cached profile (from localStorage) with the
    // server on every load -- without this, any account change made
    // outside a live "profile:changed" push (e.g. MK ULTRA granted directly
    // via an admin script rather than through the app) would only ever show
    // up after a Stripe-redirect or a lucky live socket event, never on a
    // normal reload.
    refreshSelf();
    refreshFriends();
    refreshRequests();
    refreshServers();
    refreshGroups();

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
          fromDisplayName: fromFriend?.displayName,
          fromAvatarColor: fromFriend?.avatarColor,
          fromAvatarIcon: fromFriend?.avatarIcon,
          fromAvatarUrl: fromFriend?.avatarUrl,
        };
      });
      // The incoming ringtone (CallBar) already provides audio; this just
      // adds a native OS popup so a call isn't missed while the window is
      // minimized or behind other apps -- the main point of a desktop app.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const notif = new Notification(`${fromUsername} is calling you`, { body: 'MK', tag: 'mk-call' });
          notif.onclick = () => window.focus();
        } catch {
          // Notification constructor can throw in some embedded/webview
          // contexts even when permission is 'granted' -- not worth surfacing.
        }
      }
    }

    // Fires for a new message on ANY thread (not just the one currently
    // open -- see the notify:message emit in server/app.js), so a friend
    // messaging you while you're chatting with someone else, or while the
    // window is unfocused/minimized, still gets a chime + OS notification.
    function onNotifyMessage({ threadId, fromUserId, fromUsername, preview }) {
      const isActiveThread = friendsRef.current.find((f) => f.id === activeFriendIdRef.current)?.threadId === threadId;
      if (isActiveThread && document.hasFocus()) return;

      playMessageChime();

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const notif = new Notification(fromUsername, { body: preview || 'Sent a message', tag: `mk-thread-${threadId}` });
          notif.onclick = () => {
            window.focus();
            setActiveFriendId(fromUserId);
          };
        } catch {
          // See onCallIncoming above.
        }
      }
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
        // Handles both the initial offer (we're the callee and just
        // accepted, pc already exists from handleAcceptCall) AND a
        // mid-call renegotiation offer (the other side just turned their
        // camera on for the first time this call) -- setRemoteDescription
        // + createAnswer works the same way either time.
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

    function onMegaChatReady(server) {
      setServers((prev) => (prev.find((s) => s.id === server.id) ? prev : [...prev, server]));
    }

    function onGroupUpdated({ groupId, avatarUrl }) {
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, avatarUrl } : g)));
    }

    socket.on('presence:update', onPresence);
    socket.on('friend:request-received', onRequestReceived);
    socket.on('profile:changed', onProfileChanged);
    socket.on('megachat:ready', onMegaChatReady);
    socket.on('group:updated', onGroupUpdated);
    socket.on('call:incoming', onCallIncoming);
    socket.on('call:accepted', onCallAccepted);
    socket.on('call:declined', onCallDeclined);
    socket.on('call:ended', onCallEnded);
    socket.on('call:signal', onCallSignal);
    socket.on('notify:message', onNotifyMessage);

    return () => {
      socket.off('presence:update', onPresence);
      socket.off('friend:request-received', onRequestReceived);
      socket.off('profile:changed', onProfileChanged);
      socket.off('megachat:ready', onMegaChatReady);
      socket.off('group:updated', onGroupUpdated);
      socket.off('call:incoming', onCallIncoming);
      socket.off('call:accepted', onCallAccepted);
      socket.off('notify:message', onNotifyMessage);
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
    setSessionExpired(false);
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

  // Bounces the user back to the login screen the instant any authenticated
  // API call comes back 401, instead of silently leaving stale cached data
  // on screen forever (see api.js's setUnauthorizedHandler for why this
  // exists -- a restarted server with no persistent JWT_SECRET invalidates
  // every existing token, and that used to fail invisibly). Registered
  // once; api.js calls it from wherever a 401 with a token happens to
  // surface, so it can't miss one.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSessionExpired(true);
      handleLogout();
    });
  }, [handleLogout]);

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

  function handleOpenChatSettings(friend) {
    setActiveFriendId(friend.id);
    setChatSettingsTrigger((n) => n + 1);
  }

  function handleTriggerCreateMegaChat() {
    setMegaChatCreateTrigger((n) => n + 1);
  }

  function handleTriggerCreateMiniChat() {
    // The Mini Chat create modal lives inside FriendsSidebar, which is only
    // mounted in the "Home" (friends/DMs) view -- switch there first so the
    // trigger actually has something to reach.
    setActiveServerId(null);
    setMiniChatCreateTrigger((n) => n + 1);
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

  async function handleUploadBanner(file) {
    const res = await api.uploadBanner(token, file);
    setUser((prev) => {
      const updated = { ...prev, bannerUrl: res.bannerUrl };
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

  async function handleSetDisplayName(displayName) {
    const res = await api.setDisplayName(token, displayName);
    setUser((prev) => {
      const updated = { ...prev, displayName: res.displayName };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  async function handleUploadRingtone(type, file) {
    const res = await api.uploadRingtone(token, type, file);
    const field = type === 'outgoing' ? 'ringtoneOutgoingUrl' : 'ringtoneIncomingUrl';
    setUser((prev) => {
      const updated = { ...prev, [field]: res.ringtoneUrl };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  async function handleResetRingtone(type) {
    const res = await api.resetRingtone(token, type);
    const field = type === 'outgoing' ? 'ringtoneOutgoingUrl' : 'ringtoneIncomingUrl';
    setUser((prev) => {
      const updated = { ...prev, [field]: res.ringtoneUrl };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  async function handleBuyPlus() {
    const res = await api.createPlusCheckout(token);
    if (res.url) window.location.href = res.url;
    else throw new Error('No checkout URL returned');
  }

  async function handleBuyPremium() {
    const res = await api.createPremiumCheckout(token);
    if (res.url) window.location.href = res.url;
    else throw new Error('No checkout URL returned');
  }

  async function handleBuyUltra() {
    const res = await api.createUltraCheckout(token);
    if (res.url) window.location.href = res.url;
    else throw new Error('No checkout URL returned');
  }

  async function handleCreateMegaChat(name) {
    const res = await api.createMegaChatCheckout(token, name);
    if (res.free && res.server) {
      // MK PREMIUM/ULTRA perk: free Mega Chat creation, no Stripe redirect -- the
      // server already exists, so just add it locally the same way the
      // megachat:ready socket event would for the paid flow.
      setServers((prev) => (prev.find((s) => s.id === res.server.id) ? prev : [...prev, res.server]));
      setActiveServerId(res.server.id);
    } else if (res.url) {
      window.location.href = res.url;
    } else {
      throw new Error('No checkout URL returned');
    }
  }

  function handleServerLeftOrDeleted(serverId) {
    setServers((prev) => prev.filter((s) => s.id !== serverId));
    setActiveServerId((prev) => (prev === serverId ? null : prev));
  }

  async function handleCreateGroup(name) {
    const group = await api.createGroup(token, name);
    setGroups((prev) => [group, ...prev]);
    setActiveGroupId(group.id);
    setActiveFriendId(null);
  }

  function handleSelectGroup(groupId) {
    setActiveGroupId(groupId);
    setActiveFriendId(null);
  }

  function handleGroupLeft(groupId) {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    setActiveGroupId((prev) => (prev === groupId ? null : prev));
  }

  async function handleSetUltraColor(color) {
    const res = await api.setUltraColor(token, color);
    setUser((prev) => {
      const updated = { ...prev, ultraColor: res.ultraColor };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  async function handleSetNameColor(color) {
    const res = await api.setNameColor(token, color);
    setUser((prev) => {
      const updated = { ...prev, nameColor: res.nameColor };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  async function handleUploadCustomEmoji(file) {
    const res = await api.uploadCustomEmoji(token, file);
    setUser((prev) => {
      const updated = { ...prev, customEmojiUrl: res.customEmojiUrl };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  async function handleRemoveCustomEmoji() {
    await api.removeCustomEmoji(token);
    setUser((prev) => {
      const updated = { ...prev, customEmojiUrl: null };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }

  // Account token is intentionally never stored in state/localStorage --
  // it's only ever held in TopBar's own local state for as long as it's
  // shown on screen, so it doesn't sit around in the page after Settings
  // closes.
  async function handleRevealToken(password) {
    const res = await api.revealAccountToken(token, password);
    return res.accountToken;
  }

  async function handleRegenerateToken(password) {
    const res = await api.regenerateAccountToken(token, password);
    return res.accountToken;
  }

  function setupPeerConnection(toUserId) {
    const pc = createPeerConnection({
      onIceCandidate: (candidate) => {
        getSocket().emit('call:signal', { toUserId, data: { type: 'candidate', candidate } });
      },
      onTrack: (stream) => {
        // The camera track arrives on a separate MediaStream from the mic
        // (they're added via pc.addTrack with two different local streams --
        // see handleToggleCamera), so this fires once for audio and,
        // whenever the other side turns their camera on, again for video.
        if (stream.getVideoTracks().length > 0) {
          remoteVideoStreamRef.current = stream;
          // Covers the case where the <video> element is already mounted
          // (e.g. this is the second time the remote camera turned on this
          // call) -- the effect above covers the first time, when it isn't
          // mounted yet.
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
          const vTrack = stream.getVideoTracks()[0];
          setRemoteHasVideo(!vTrack.muted);
          vTrack.onmute = () => setRemoteHasVideo(false);
          vTrack.onunmute = () => setRemoteHasVideo(true);
          vTrack.onended = () => setRemoteHasVideo(false);
        } else {
          if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
        }
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
      localStreamRef.current = await getMicStream(settings.micDeviceId);
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
    const { fromUserId, fromUsername, fromAvatarColor, fromAvatarIcon, fromAvatarUrl } = call;
    try {
      localStreamRef.current = await getMicStream(settings.micDeviceId);
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
      avatarIcon: fromAvatarIcon,
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

  // Turning the camera on for the first time in a call adds a brand-new
  // video track/m-line, which needs a fresh offer/answer round (WebRTC
  // renegotiation) so the other side even knows it exists. Every toggle
  // after that just swaps the sender's track via replaceTrack(), which
  // doesn't touch the SDP at all -- no renegotiation, no risk of both sides
  // renegotiating at once (a real risk if this ran on every single toggle).
  async function handleToggleCamera() {
    const pc = pcRef.current;
    if (!pc || !call || call.status !== 'active') return;

    // Camera and screen share are two possible sources for the same local
    // video slot (see handleToggleScreenShare) -- turning the camera on
    // while screen sharing is active stops the share first, then falls
    // through to the normal camSenderRef.replaceTrack() path below, same as
    // if the camera had been toggled off and back on mid-call.
    if (!cameraOn && screenSharing) {
      stopStream(screenStreamRef.current);
      screenStreamRef.current = null;
      setScreenSharing(false);
    }

    if (cameraOn) {
      stopStream(camStreamRef.current);
      camStreamRef.current = null;
      if (camSenderRef.current) {
        try { await camSenderRef.current.replaceTrack(null); } catch (err) { console.error('replaceTrack(null) failed:', err.message); }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setCameraOn(false);
      return;
    }

    let camStream;
    try {
      camStream = await getCamStream(settings.camDeviceId);
    } catch (err) {
      console.error('Camera access denied or unavailable:', err.message);
      return;
    }
    camStreamRef.current = camStream;
    const videoTrack = camStream.getVideoTracks()[0];

    if (camSenderRef.current) {
      // Camera was on earlier this call and got turned off -- the sender
      // (and its m-line) already exists, so just swap the track back in.
      try {
        await camSenderRef.current.replaceTrack(videoTrack);
      } catch (err) {
        console.error('replaceTrack failed:', err.message);
        stopStream(camStream);
        camStreamRef.current = null;
        return;
      }
    } else {
      // First time this call -- adds a new m-line, so the other side needs
      // a fresh offer describing it.
      camSenderRef.current = pc.addTrack(videoTrack, camStream);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        getSocket().emit('call:signal', { toUserId: remoteUserIdRef.current, data: { type: 'offer', sdp: offer } });
      } catch (err) {
        console.error('Camera renegotiation failed:', err.message);
      }
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = camStream;
    setCameraOn(true);
  }

  // Free for everyone -- no isPlus/isPremium/isUltra gate, same as the
  // camera toggle. Shares the camera's video m-line/sender via
  // replaceTrack() rather than adding a second one, so the remote side
  // needs zero code changes: whatever arrives on that track (camera frames
  // or screen frames) just renders as their existing "remoteHasVideo" feed.
  async function handleToggleScreenShare() {
    const pc = pcRef.current;
    if (!pc || !call || call.status !== 'active') return;

    if (screenSharing) {
      stopStream(screenStreamRef.current);
      screenStreamRef.current = null;
      if (camSenderRef.current) {
        try { await camSenderRef.current.replaceTrack(null); } catch (err) { console.error('replaceTrack(null) failed:', err.message); }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setScreenSharing(false);
      return;
    }

    // Only one local video source at a time -- stop the camera first if
    // it's on, the same way handleToggleCamera stops an active screen share.
    if (cameraOn) {
      stopStream(camStreamRef.current);
      camStreamRef.current = null;
      setCameraOn(false);
    }

    let screenStream;
    try {
      screenStream = await getScreenStream();
    } catch (err) {
      // User cancelled the browser's own screen picker or denied
      // permission -- not a real error, just leave everything as-is.
      return;
    }
    screenStreamRef.current = screenStream;
    const videoTrack = screenStream.getVideoTracks()[0];

    // The browser's own "Stop sharing" control (a bar/indicator outside our
    // UI, shown on the shared tab/window/OS chrome) ends the track
    // directly -- this is the only way to hear about that and revert our
    // button/preview state to match what the browser just did.
    videoTrack.onended = () => {
      screenStreamRef.current = null;
      if (camSenderRef.current) camSenderRef.current.replaceTrack(null).catch(() => {});
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setScreenSharing(false);
    };

    if (camSenderRef.current) {
      // Camera (or an earlier share) already added the m-line this call --
      // just swap the track in, no renegotiation needed.
      try {
        await camSenderRef.current.replaceTrack(videoTrack);
      } catch (err) {
        console.error('replaceTrack failed:', err.message);
        stopStream(screenStream);
        screenStreamRef.current = null;
        return;
      }
    } else {
      // First video source this call -- adds a new m-line, so the other
      // side needs a fresh offer describing it.
      camSenderRef.current = pc.addTrack(videoTrack, screenStream);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        getSocket().emit('call:signal', { toUserId: remoteUserIdRef.current, data: { type: 'offer', sdp: offer } });
      } catch (err) {
        console.error('Screen share renegotiation failed:', err.message);
      }
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = screenStream;
    setScreenSharing(true);
  }

  if (!token || !user) {
    return <AuthScreen onAuthed={handleAuthed} sessionExpired={sessionExpired} />;
  }

  const activeFriend = friends.find((f) => f.id === activeFriendId) || null;

  // Mobile layout: only one pane (the list, or the active chat) is shown at
  // a time -- this flag drives that via a CSS class rather than unmounting
  // anything, so no chat/socket state is lost when switching back and
  // forth. "A chat is open" means any of the three mutually-exclusive
  // selections is set.
  const mobileChatOpen = activeServerId !== null || activeGroupId !== null || activeFriendId !== null || call?.status === 'active';

  function handleMobileBack() {
    if (activeServerId !== null) setActiveServerId(null);
    else if (activeGroupId !== null) setActiveGroupId(null);
    else if (activeFriendId !== null) setActiveFriendId(null);
  }

  // Discord-style "full takeover": while a call is active, this replaces
  // whatever the chat pane would normally show (ChatArea/MiniChatView/
  // MegaChatView) below, in both the friends-view and server-view branches
  // -- the server rail and friends/channel list stay visible on the left,
  // only the content pane itself becomes the call screen. Built once here
  // (rather than inline in each branch) since it's the same element either
  // way.
  const activeCallView = call?.status === 'active' ? (
    <ActiveCallView
      call={call}
      muted={muted}
      cameraOn={cameraOn}
      screenSharing={screenSharing}
      remoteHasVideo={remoteHasVideo}
      localVideoRef={localVideoRef}
      remoteVideoRef={remoteVideoRef}
      onHangUp={handleEndOrCancelCall}
      onToggleMute={handleToggleMute}
      onToggleCamera={handleToggleCamera}
      onToggleScreenShare={handleToggleScreenShare}
    />
  ) : null;

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
        currentUser={user}
        onUploadRingtone={handleUploadRingtone}
        onResetRingtone={handleResetRingtone}
        onBuyPlus={handleBuyPlus}
        onBuyPremium={handleBuyPremium}
        onBuyUltra={handleBuyUltra}
        onSetUltraColor={handleSetUltraColor}
        onSetNameColor={handleSetNameColor}
        onUploadCustomEmoji={handleUploadCustomEmoji}
        onRemoveCustomEmoji={handleRemoveCustomEmoji}
        onRevealToken={handleRevealToken}
        onRegenerateToken={handleRegenerateToken}
        billingConfigured={billingConfigured}
        onCreateMegaChat={handleTriggerCreateMegaChat}
        onCreateMiniChat={handleTriggerCreateMiniChat}
        onFetchStats={() => api.getMyStats(token)}
        onAdminListUsers={() => api.adminListUsers(token)}
        onAdminSetTier={(userId, tier, value) => api.adminSetTier(token, userId, tier, value)}
        onAdminSetAdmin={(userId, value) => api.adminSetAdmin(token, userId, value)}
        onAdminDeleteUser={(userId) => api.adminDeleteUser(token, userId)}
        t={t}
      />
      {call && call.status !== 'active' && (
        <CallBar
          call={call}
          onAccept={handleAcceptCall}
          onDecline={handleDeclineCall}
          onCancel={handleEndOrCancelCall}
          ringtoneOutgoingUrl={user.ringtoneOutgoingUrl}
          ringtoneIncomingUrl={user.ringtoneIncomingUrl}
        />
      )}
      <audio ref={remoteAudioRef} autoPlay />
      <div className={`app-shell ${mobileChatOpen ? 'mobile-chat-open' : ''}`}>
        <ServerRail
          servers={servers}
          activeServerId={activeServerId}
          onSelectHome={() => setActiveServerId(null)}
          onSelectServer={(id) => setActiveServerId(id)}
          isPremium={!!user.isPremium}
          onCreate={handleCreateMegaChat}
          createTrigger={megaChatCreateTrigger}
        />
        {activeServerId === null ? (
          <>
            <FriendsSidebar
              friends={friends}
              activeFriendId={activeFriendId}
              onSelect={(f) => { setActiveFriendId(f.id); setActiveGroupId(null); }}
              currentUser={user}
              token={token}
              onLogout={handleLogout}
              onChangeAvatar={handleChangeAvatar}
              onUploadBanner={handleUploadBanner}
              onSetBio={handleSetBio}
              onSetDisplayName={handleSetDisplayName}
              onOpenChatSettings={handleOpenChatSettings}
              onRemoveFriend={handleRemoveFriend}
              groups={groups}
              activeGroupId={activeGroupId}
              onSelectGroup={handleSelectGroup}
              onCreateGroup={handleCreateGroup}
              createGroupTrigger={miniChatCreateTrigger}
            />
            {activeCallView ? activeCallView : activeGroupId !== null ? (
              (() => {
                const activeGroup = groups.find((g) => g.id === activeGroupId) || null;
                return activeGroup ? (
                  <MiniChatView
                    key={activeGroup.id}
                    group={activeGroup}
                    token={token}
                    currentUser={user}
                    onLeft={handleGroupLeft}
                    onBack={handleMobileBack}
                  />
                ) : null;
              })()
            ) : (
              <ChatArea
                token={token}
                friend={activeFriend}
                currentUser={user}
                onRemoveFriend={handleRemoveFriend}
                onStartCall={handleStartCall}
                callActive={!!call}
                chatLayout={settings.chatLayout}
                openSettingsTrigger={chatSettingsTrigger}
                onBack={handleMobileBack}
                t={t}
              />
            )}
          </>
        ) : activeCallView ? activeCallView : (
          (() => {
            const activeServer = servers.find((s) => s.id === activeServerId) || null;
            return activeServer ? (
              <MegaChatView
                key={activeServer.id}
                server={activeServer}
                token={token}
                currentUser={user}
                onLeftOrDeleted={handleServerLeftOrDeleted}
                onBack={handleMobileBack}
              />
            ) : null;
          })()
        )}
      </div>
    </div>
  );
}
