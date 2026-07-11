import { useEffect, useRef, useState } from 'react';

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A cassette-tape-styled player for voice/audio message attachments. Wraps
// a hidden native <audio> element -- all the actual playback, seeking, and
// buffering is delegated to it; this component only draws a tape deck skin
// around it (spinning reels, a scrubbable "tape" strip, a tape-counter
// style time readout) and drives its play state.
export default function CassettePlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    const onLoaded = () => setDuration(el.duration || 0);
    const onEnded = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('ended', onEnded);
    };
  }, []);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().catch(() => {});
      setPlaying(true);
    }
  }

  function handleScrub(e) {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrentTime(el.currentTime);
  }

  const progress = duration ? currentTime / duration : 0;

  return (
    <div className="cassette-player">
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="cassette-body">
        <div className="cassette-window">
          <div className={`cassette-reel ${playing ? 'spinning' : ''}`}>
            <div className="cassette-reel-hub" />
          </div>
          <div className="cassette-tape-arc" />
          <div className={`cassette-reel ${playing ? 'spinning' : ''}`}>
            <div className="cassette-reel-hub" />
          </div>
        </div>
        <div className="cassette-label">
          <div className="cassette-label-line cassette-label-line-title">SIDE A</div>
          <div className="cassette-label-line cassette-label-line-sub">VOICE MEMO</div>
        </div>
      </div>
      <div className="cassette-controls">
        <button
          type="button"
          className="cassette-play-btn"
          onClick={togglePlay}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="0.5" width="3.4" height="11" fill="currentColor" /><rect x="7.6" y="0.5" width="3.4" height="11" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="1,0.5 11,6 1,11.5" fill="currentColor" /></svg>
          )}
        </button>
        <div className="cassette-tape-strip" onClick={handleScrub}>
          <div className="cassette-tape-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="cassette-counter">{formatTime(currentTime)} / {formatTime(duration)}</div>
      </div>
    </div>
  );
}
