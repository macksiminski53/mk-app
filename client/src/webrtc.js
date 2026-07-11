// Thin WebRTC helpers for 1:1 voice calls. Signaling (who's calling whom,
// offer/answer/ICE candidates) travels over the existing Socket.io
// connection -- see the `call:*` events in server/index.js and the call
// state machine in App.jsx. No TURN server is configured (Google's public
// STUN servers only), so calls between two peers both behind restrictive/
// symmetric NATs may fail to connect -- that's a known limitation of a
// STUN-only setup, not a bug.

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function createPeerConnection({ onIceCandidate, onTrack, onConnectionStateChange }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (e) => {
    if (e.candidate) onIceCandidate(e.candidate);
  };

  pc.ontrack = (e) => {
    onTrack(e.streams[0]);
  };

  if (onConnectionStateChange) {
    pc.onconnectionstatechange = () => onConnectionStateChange(pc.connectionState);
  }

  return pc;
}

export async function getMicStream(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    video: false,
  });
}

// Lists available audio input (mic) and output (speaker) devices for the
// Voice Chat settings tab. Labels are only populated once the browser has
// been granted mic permission at least once (otherwise they come back
// blank) -- that's a browser privacy restriction, not a bug here.
export async function listAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: devices.filter((d) => d.kind === 'audioinput'),
    outputs: devices.filter((d) => d.kind === 'audiooutput'),
  };
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}
