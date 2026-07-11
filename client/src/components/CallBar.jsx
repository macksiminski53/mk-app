import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { PhoneIcon, PhoneHangupIcon, MicIcon, MicMutedIcon, CameraIcon, CameraOffIcon, CallCloseIcon } from './CallIcons.jsx';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Renders whichever call UI is active as a floating overlay card centered
// near the top of the screen (rather than a thin full-width bar) -- a
// bigger avatar with a pulsing ring while ringing, and larger controls,
// closer to a phone call screen than Discord's compact bar. Renders
// nothing if call.status is null -- App.jsx only mounts this when there's
// a call.
export default function CallBar({ call, onAccept, onDecline, onCancel, onHangUp, onToggleMute, muted, cameraOn, remoteHasVideo, localVideoRef, remoteVideoRef, onToggleCamera, ringtoneOutgoingUrl, ringtoneIncomingUrl }) {
  const [elapsed, setElapsed] = useState(0);
  const outgoingAudioRef = useRef(null);
  const incomingAudioRef = useRef(null);

  useEffect(() => {
    if (call?.status !== 'active') return;
    setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [call?.status, call?.startedAt]);

  // Ringtones: "Calling…" loops for the caller until the other side joins
  // (status leaves 'outgoing'); the incoming ringtone loops for the callee
  // until they answer/decline (status leaves 'incoming'). Whichever one
  // isn't relevant to the current status gets paused and rewound so it's
  // ready to start clean next time.
  useEffect(() => {
    const outgoing = outgoingAudioRef.current;
    const incoming = incomingAudioRef.current;
    if (!outgoing || !incoming) return;

    if (call?.status === 'outgoing') {
      incoming.pause();
      incoming.currentTime = 0;
      outgoing.currentTime = 0;
      outgoing.play().catch(() => {});
    } else if (call?.status === 'incoming') {
      outgoing.pause();
      outgoing.currentTime = 0;
      incoming.currentTime = 0;
      incoming.play().catch(() => {});
    } else {
      outgoing.pause();
      outgoing.currentTime = 0;
      incoming.pause();
      incoming.currentTime = 0;
    }
  }, [call?.status]);

  if (!call) return null;

  const ringtones = (
    <>
      <audio ref={outgoingAudioRef} src={ringtoneOutgoingUrl || '/sounds/calling.mp3'} loop preload="auto" />
      <audio ref={incomingAudioRef} src={ringtoneIncomingUrl || '/sounds/incoming.mp3'} loop preload="auto" />
    </>
  );

  if (call.status === 'incoming') {
    return (
      <div className="call-overlay-backdrop">
        {ringtones}
        <div className="call-overlay call-overlay-ringing">
          <div className="call-overlay-avatar-wrap call-overlay-pulse">
            <Avatar username={call.fromUsername} avatarColor={call.fromAvatarColor} avatarUrl={call.fromAvatarUrl} size={88} />
          </div>
          <div className="call-overlay-name">{call.fromUsername}</div>
          <div className="call-overlay-sub call-overlay-sub-ringing">Incoming call…</div>
          <div className="call-overlay-actions">
            <button className="call-overlay-btn call-overlay-btn-decline" onClick={onDecline} title="Decline">
              <CallCloseIcon size={22} />
            </button>
            <button className="call-overlay-btn call-overlay-btn-accept" onClick={onAccept} title="Accept">
              <PhoneIcon size={24} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (call.status === 'outgoing') {
    return (
      <div className="call-overlay-backdrop">
        {ringtones}
        <div className="call-overlay call-overlay-ringing">
          <div className="call-overlay-avatar-wrap call-overlay-pulse">
            <Avatar username={call.friend.username} avatarColor={call.friend.avatarColor} avatarUrl={call.friend.avatarUrl} size={88} />
          </div>
          <div className="call-overlay-name">{call.friend.username}</div>
          <div className="call-overlay-sub call-overlay-sub-ringing">Calling…</div>
          <div className="call-overlay-actions">
            <button className="call-overlay-btn call-overlay-btn-decline" onClick={onCancel} title="Cancel">
              <CallCloseIcon size={22} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // active
  const showVideo = cameraOn || remoteHasVideo;
  return (
    <div className="call-overlay-anchor">
      {ringtones}
      <div className={`call-overlay call-overlay-active ${showVideo ? 'call-overlay-video' : ''}`}>
        {showVideo && (
          <div className="call-video-stage">
            {remoteHasVideo ? (
              <video ref={remoteVideoRef} autoPlay playsInline className="call-video-remote" />
            ) : (
              <div className="call-video-remote call-video-remote-placeholder">
                <Avatar username={call.friend.username} avatarColor={call.friend.avatarColor} avatarUrl={call.friend.avatarUrl} size={72} />
              </div>
            )}
            {cameraOn && (
              <video ref={localVideoRef} autoPlay playsInline muted className="call-video-local" />
            )}
          </div>
        )}
        {!showVideo && (
          <div className="call-overlay-avatar-wrap">
            <Avatar username={call.friend.username} avatarColor={call.friend.avatarColor} avatarUrl={call.friend.avatarUrl} size={72} />
            <span className="call-overlay-live-dot" />
          </div>
        )}
        <div className="call-overlay-name">{call.friend.username}</div>
        <div className="call-overlay-sub">{formatDuration(elapsed)}</div>
        <div className="call-overlay-actions">
          <button
            className={`call-overlay-btn ${muted ? 'call-overlay-btn-muted-on' : 'call-overlay-btn-muted-off'}`}
            onClick={onToggleMute}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicMutedIcon size={20} /> : <MicIcon size={20} />}
          </button>
          <button
            className={`call-overlay-btn ${cameraOn ? 'call-overlay-btn-muted-off' : 'call-overlay-btn-muted-on'}`}
            onClick={onToggleCamera}
            title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
          >
            {cameraOn ? <CameraIcon size={20} /> : <CameraOffIcon size={20} />}
          </button>
          <button className="call-overlay-btn call-overlay-btn-decline" onClick={onHangUp} title="Hang up">
            <PhoneHangupIcon size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
