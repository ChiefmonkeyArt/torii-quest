// audio.js — WebAudio SFX. Lazy AudioContext (must resume on first user gesture).
// Single shared context; no setTimeout; no allocations beyond per-event nodes
// (browsers GC oscillator/gain pairs after stop()).

let _ctx = null;

function _audioCtx() {
  if (_ctx) return _ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  _ctx = new AC();
  return _ctx;
}

// Resume the context on first user gesture (browsers auto-suspend until then).
// Listener self-removes after first invocation.
function _attachResumer() {
  const resume = () => {
    const ctx = _audioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    window.removeEventListener('pointerdown', resume, true);
    window.removeEventListener('keydown',     resume, true);
  };
  window.addEventListener('pointerdown', resume, true);
  window.addEventListener('keydown',     resume, true);
}
_attachResumer();

// playShoot — soft laser "pew". Sine sweep ~880Hz → ~220Hz over 90ms,
// peak gain 0.10 (well below previous square-wave 0.55 clank).
// A whisper of bandpassed noise (gain 0.04) adds breath without harshness.
export function playShoot() {
  const ctx = _audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Tone — sine sweep
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.09);
  gain.gain.setValueAtTime(0.10, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.11);

  // Subtle breath — short filtered noise burst
  const dur = 0.06;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const bp    = ctx.createBiquadFilter();
  src.buffer = buf;
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.8;
  ngain.gain.setValueAtTime(0.04, t);
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(ngain);
  ngain.connect(ctx.destination);
  src.start(t);
}
