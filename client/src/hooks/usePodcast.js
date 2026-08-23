import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { createPeerConnection, getMicStream, stopStream } from '../webrtc.js';

const EMPTY_SESSION = { isLive: false, hostId: null, hostUsername: null, hostDisplayName: null, title: null, startedAt: null, speakers: [] };

// Manages the Podcast feature: one global live audio broadcast, host +
// approved co-speakers all hearing each other (a full mesh -- every
// speaker connects directly to every other speaker), and any number of
// listeners who each connect directly to every speaker (receive-only,
// no track of their own to negotiate).
//
// Tie-breaker for who initiates the offer in a speaker<->speaker pair:
// the lower user id always offers, the higher id always answers. Applied
// identically whether you're the one who just started speaking (offering
// toward existing speakers with a higher id) or an existing speaker
// reacting to someone new joining (offering toward them if your id is
// lower) -- exactly one side initiates per pair either way, since ids are
// unique. Listeners always initiate (they have nothing to negotiate
// glare over, since they never offer to be offered to).
export function usePodcast(token, currentUser) {
  const [session, setSession] = useState(EMPTY_SESSION);
  const [role, setRole] = useState('none'); // 'none' | 'listening' | 'speaking'
  const [pendingRequest, setPendingRequest] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState([]);

  const roleRef = useRef('none');
  const myIdRef = useRef(currentUser?.id);
  const sessionRef = useRef(EMPTY_SESSION);
  useEffect(() => { myIdRef.current = currentUser?.id; }, [currentUser?.id]);
  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const peersRef = useRef(new Map()); // userId -> RTCPeerConnection
  const audioElsRef = useRef(new Map()); // userId -> HTMLAudioElement (remote playback)
  const iceQueuesRef = useRef(new Map()); // userId -> pending ICE candidates before remoteDescription is set
  const localStreamRef = useRef(null); // mic stream, only set while speaking

  const closePeer = useCallback((peerId) => {
    const pc = peersRef.current.get(peerId);
    if (pc) { pc.close(); peersRef.current.delete(peerId); }
    const el = audioElsRef.current.get(peerId);
    if (el) { el.srcObject = null; audioElsRef.current.delete(peerId); }
    iceQueuesRef.current.delete(peerId);
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const id of Array.from(peersRef.current.keys())) closePeer(id);
  }, [closePeer]);

  const ensurePeer = useCallback((peerId) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);
    const pc = createPeerConnection({
      onIceCandidate: (candidate) => {
        getSocket()?.emit('podcast:signal', { toUserId: peerId, data: { type: 'candidate', candidate } });
      },
      onTrack: (stream) => {
        let el = audioElsRef.current.get(peerId);
        if (!el) {
          el = new Audio();
          el.autoplay = true;
          audioElsRef.current.set(peerId, el);
        }
        el.srcObject = stream;
      },
      onConnectionStateChange: (state) => {
        if (state === 'failed' || state === 'closed') closePeer(peerId);
      },
    });
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getAudioTracks()) pc.addTrack(track, localStreamRef.current);
    }
    peersRef.current.set(peerId, pc);
    return pc;
  }, [closePeer]);

  const initiateOfferTo = useCallback(async (peerId, { recvOnly = false } = {}) => {
    const pc = ensurePeer(peerId);
    if (recvOnly) pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    getSocket()?.emit('podcast:signal', { toUserId: peerId, data: { type: 'offer', sdp: offer } });
  }, [ensurePeer]);

  const flushIceQueue = useCallback(async (peerId, pc) => {
    const queue = iceQueuesRef.current.get(peerId) || [];
    for (const c of queue) await pc.addIceCandidate(c).catch(() => {});
    iceQueuesRef.current.delete(peerId);
  }, []);

  // ---- Socket event wiring ----
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !token) return;

    async function onSignal({ fromUserId, data }) {
      const pc = ensurePeer(fromUserId);
      if (data.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushIceQueue(fromUserId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        getSocket()?.emit('podcast:signal', { toUserId: fromUserId, data: { type: 'answer', sdp: answer } });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushIceQueue(fromUserId, pc);
      } else if (data.type === 'candidate') {
        const candidate = new RTCIceCandidate(data.candidate);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate).catch(() => {});
        } else {
          if (!iceQueuesRef.current.has(fromUserId)) iceQueuesRef.current.set(fromUserId, []);
          iceQueuesRef.current.get(fromUserId).push(candidate);
        }
      }
    }

    function onStarted(newSession) {
      setSession(newSession);
      // Don't auto-connect anything -- tuning in (listening) or being
      // approved to speak both happen via an explicit user action
      // elsewhere, not automatically just because a broadcast started
      // somewhere in the app.
    }

    function onEnded() {
      setSession(EMPTY_SESSION);
      setIncomingRequests([]);
      setPendingRequest(false);
      closeAllPeers();
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      setRole('none');
    }

    function onJoinRequest({ requester }) {
      setIncomingRequests((prev) => (prev.find((r) => r.id === requester.id) ? prev : [...prev, requester]));
    }

    function onRequestResolved({ accepted }) {
      setPendingRequest(false);
      if (accepted) {
        // Becoming a speaker: get the mic, then mesh with whoever's
        // already speaking (session.speakers reflects pre-me state at
        // this point since the server hasn't sent speaker-joined for
        // myself back to me).
        (async () => {
          try {
            const stream = await getMicStream();
            localStreamRef.current = stream;
            for (const pc of peersRef.current.values()) {
              for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
            }
            setRole('speaking');
            const myId = myIdRef.current;
            for (const speaker of sessionRef.current.speakers) {
              if (speaker.id === myId) continue;
              if (myId < speaker.id) initiateOfferTo(speaker.id);
              // else: they'll initiate toward me via their own
              // speaker-joined handler below.
            }
          } catch (e) {
            // Mic permission denied or unavailable -- stay a listener.
            console.error('Could not get microphone:', e);
          }
        })();
      }
    }

    function onSpeakerJoined({ speaker }) {
      setSession((prev) => ({
        ...prev,
        speakers: prev.speakers.find((s) => s.id === speaker.id) ? prev.speakers : [...prev.speakers, speaker],
      }));
      const myId = myIdRef.current;
      if (speaker.id === myId) return;
      if (roleRef.current === 'speaking' && myId < speaker.id) {
        initiateOfferTo(speaker.id);
      } else if (roleRef.current === 'listening') {
        initiateOfferTo(speaker.id, { recvOnly: true });
      }
    }

    function onSpeakerLeft({ userId: leftId }) {
      setSession((prev) => ({ ...prev, speakers: prev.speakers.filter((s) => s.id !== leftId) }));
      closePeer(leftId);
    }

    socket.on('podcast:signal', onSignal);
    socket.on('podcast:started', onStarted);
    socket.on('podcast:ended', onEnded);
    socket.on('podcast:join-request', onJoinRequest);
    socket.on('podcast:request-resolved', onRequestResolved);
    socket.on('podcast:speaker-joined', onSpeakerJoined);
    socket.on('podcast:speaker-left', onSpeakerLeft);

    return () => {
      socket.off('podcast:signal', onSignal);
      socket.off('podcast:started', onStarted);
      socket.off('podcast:ended', onEnded);
      socket.off('podcast:join-request', onJoinRequest);
      socket.off('podcast:request-resolved', onRequestResolved);
      socket.off('podcast:speaker-joined', onSpeakerJoined);
      socket.off('podcast:speaker-left', onSpeakerLeft);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // only re-binds on token change; the handlers read fresh state via refs.
  }, [token, ensurePeer, closePeer, closeAllPeers, flushIceQueue, initiateOfferTo]);

  // Initial status fetch on mount / login.
  useEffect(() => {
    if (!token) return;
    api.podcastStatus(token).then(setSession).catch(() => {});
  }, [token]);

  // Fetch pending requests when I become the host of a live session.
  useEffect(() => {
    if (!token || session.hostId !== currentUser?.id || !session.isLive) {
      setIncomingRequests([]);
      return;
    }
    api.podcastRequests(token).then(setIncomingRequests).catch(() => {});
  }, [token, session.hostId, session.isLive, currentUser?.id]);

  const startPodcast = useCallback(async (title) => {
    const newSession = await api.podcastStart(token, title);
    setSession(newSession);
    const stream = await getMicStream();
    localStreamRef.current = stream;
    setRole('speaking');
  }, [token]);

  const endPodcastAction = useCallback(async () => {
    await api.podcastEnd(token);
    setSession(EMPTY_SESSION);
    closeAllPeers();
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    setRole('none');
  }, [token, closeAllPeers]);

  const startListening = useCallback(() => {
    if (role !== 'none') return;
    setRole('listening');
    for (const speaker of session.speakers) {
      if (speaker.id === myIdRef.current) continue;
      initiateOfferTo(speaker.id, { recvOnly: true });
    }
  }, [role, session.speakers, initiateOfferTo]);

  const stopListening = useCallback(() => {
    closeAllPeers();
    setRole('none');
  }, [closeAllPeers]);

  const requestJoin = useCallback(async () => {
    setPendingRequest(true);
    try {
      await api.podcastRequestJoin(token);
    } catch (e) {
      setPendingRequest(false);
      throw e;
    }
  }, [token]);

  const leaveStage = useCallback(async () => {
    await api.podcastLeave(token);
    closeAllPeers();
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    setRole('listening');
    for (const speaker of session.speakers) {
      if (speaker.id === myIdRef.current) continue;
      initiateOfferTo(speaker.id, { recvOnly: true });
    }
  }, [token, closeAllPeers, session.speakers, initiateOfferTo]);

  const acceptRequest = useCallback(async (userId) => {
    await api.podcastAcceptRequest(token, userId);
    setIncomingRequests((prev) => prev.filter((r) => r.id !== userId));
  }, [token]);

  const declineRequest = useCallback(async (userId) => {
    await api.podcastDeclineRequest(token, userId);
    setIncomingRequests((prev) => prev.filter((r) => r.id !== userId));
  }, [token]);

  return {
    session,
    role,
    pendingRequest,
    incomingRequests,
    startPodcast,
    endPodcast: endPodcastAction,
    startListening,
    stopListening,
    requestJoin,
    leaveStage,
    acceptRequest,
    declineRequest,
  };
}
