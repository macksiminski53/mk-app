// A short two-tone notification chime synthesized with the Web Audio API
// instead of a bundled sound file -- no asset to ship, no licensing to
// worry about, and it works identically in the browser and in the Electron
// desktop shell (see desktop/main.js).
let ctx = null;

function getContext() {
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    ctx = new AudioContextClass();
  }
  // Browsers suspend a freshly-created AudioContext until a user gesture;
  // by the time a notification fires the user has almost certainly
  // interacted with the page already, but resume() is a harmless no-op if
  // it's already running.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function beep(freq, startTime, duration, gainValue = 0.15) {
  const audioCtx = getContext();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

// A quick rising two-note chime for new messages.
export function playMessageChime() {
  const audioCtx = getContext();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  beep(660, now, 0.14);
  beep(880, now + 0.1, 0.18);
}
