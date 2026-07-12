import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import { MicIcon, MicMutedIcon, CameraIcon, CameraOffIcon, ScreenShareIcon, ScreenShareOffIcon, PhoneHangupIcon } from './CallIcons.jsx';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Discord-style "full takeover" call screen: while a call is active, this
// replaces the chat pane entirely (App.jsx renders it in place of
// ChatArea/MegaChatView/MiniChatView, see the activeServerId/activeGroupId
// ternaries) instead of floating as a small card on top of the chat like
// the old design did. The server rail and friends/channel list stay put on
// the left, exactly like Discord keeps the channel list visible during a
// call and only swaps out the message area.
export default function ActiveCallView({ call, muted, cameraOn, screenSharing, remoteHasVideo, localVideoRef, remoteVideoRef, onHangUp, onToggleMute, onToggleCamera, onToggleScreenShare }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [call.startedAt]);

  const showVideo = cameraOn || screenSharing || remoteHasVideo;
  const name = call.friend.displayName || call.friend.username;

  return (
    <div className="active-call-view">
      <div className="active-call-topbar">
        <span className="active-call-live-pill">
          <span className="active-call-live-dot" /> {formatDuration(elapsed)}
        </span>
        <span className="active-call-topbar-name">{name}</span>
      </div>

      <div className={`active-call-stage ${showVideo ? 'active-call-stage-video' : ''}`}>
        {showVideo ? (
          <>
            {remoteHasVideo ? (
              <video ref={remoteVideoRef} autoPlay playsInline className="active-call-video-remote" />
            ) : (
              <div className="active-call-video-remote active-call-video-placeholder">
                <Avatar username={name} avatarColor={call.friend.avatarColor} avatarIcon={call.friend.avatarIcon} avatarUrl={call.friend.avatarUrl} size={96} />
                <span className="active-call-placeholder-name">{name}</span>
              </div>
            )}
            {(cameraOn || screenSharing) && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`active-call-video-local ${screenSharing ? 'active-call-video-local-screen' : ''}`}
              />
            )}
          </>
        ) : (
          <div className="active-call-avatar-wrap">
            <div className="active-call-avatar-pulse">
              <Avatar username={name} avatarColor={call.friend.avatarColor} avatarIcon={call.friend.avatarIcon} avatarUrl={call.friend.avatarUrl} size={128} />
            </div>
            <div className="active-call-name">{name}</div>
            <div className="active-call-sub">Voice Connected</div>
          </div>
        )}
      </div>

      <div className="active-call-controls">
        <button
          className={`active-call-btn ${muted ? 'active-call-btn-off' : ''}`}
          onClick={onToggleMute}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <MicMutedIcon size={22} /> : <MicIcon size={22} />}
        </button>
        <button
          className={`active-call-btn ${cameraOn ? 'active-call-btn-on' : ''}`}
          onClick={onToggleCamera}
          title={cameraOn ? 'Turn off camera' : screenSharing ? 'Switch to camera' : 'Turn on camera'}
        >
          {cameraOn ? <CameraIcon size={22} /> : <CameraOffIcon size={22} />}
        </button>
        <button
          className={`active-call-btn ${screenSharing ? 'active-call-btn-on' : ''}`}
          onClick={onToggleScreenShare}
          title={screenSharing ? 'Stop sharing your screen' : 'Share your screen'}
        >
          {screenSharing ? <ScreenShareOffIcon size={22} /> : <ScreenShareIcon size={22} />}
        </button>
        <button className="active-call-btn active-call-btn-hangup" onClick={onHangUp} title="Hang up">
          <PhoneHangupIcon size={22} />
        </button>
      </div>
    </div>
  );
}
