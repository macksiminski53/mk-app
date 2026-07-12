import { useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import { PhoneIcon, CallCloseIcon } from './CallIcons.jsx';

// Renders the incoming/outgoing ringing screen as a floating overlay card
// centered near the top of the app -- a modal-ish dialog since you're not
// yet "in" the call. Once the call goes active, App.jsx stops mounting this
// and mounts ActiveCallView instead (the full Discord-style takeover of the
// chat pane) -- see the call.status === 'active' branches in App.jsx's main
// content area. Renders nothing once call.status leaves 'incoming'/
// 'outgoing' -- App.jsx only mounts this for those two ringing states.
export default function CallBar({ call, onAccept, onDecline, onCancel, ringtoneOutgoingUrl, ringtoneIncomingUrl }) {
  const outgoingAudioRef = useRef(null);
  const incomingAudioRef = useRef(null);

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
            <Avatar username={call.fromDisplayName || call.fromUsername} avatarColor={call.fromAvatarColor} avatarUrl={call.fromAvatarUrl} size={88} />
          </div>
          <div className="call-overlay-name">{call.fromDisplayName || call.fromUsername}</div>
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
            <Avatar username={call.friend.displayName || call.friend.username} avatarColor={call.friend.avatarColor} avatarUrl={call.friend.avatarUrl} size={88} />
          </div>
          <div className="call-overlay-name">{call.friend.displayName || call.friend.username}</div>
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

  return null;
}
