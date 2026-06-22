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

// playShoot — deeper soft laser "pow". Sine sweep ~440Hz → ~90Hz over 110ms,
// peak gain 0.11. Lower fundamental gives more body/thump while staying soft.
// A whisper of low-bandpassed noise adds breath without harshness.
export function playShoot() {
  const ctx = _audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Tone — deeper sine sweep
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(90, t + 0.11);
  gain.gain.setValueAtTime(0.11, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.13);

  // Subtle low breath — short low-bandpassed noise burst for body
  const dur = 0.07;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const bp    = ctx.createBiquadFilter();
  src.buffer = buf;
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 0.7;
  ngain.gain.setValueAtTime(0.04, t);
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(ngain);
  ngain.connect(ctx.destination);
  src.start(t);
}

// ── Footstep — soft thud, alternating L/R pitch ────────────────────────────
// Called by main.js dt-accumulator while player is moving on the ground.
// Two pitches alternate per step for natural cadence. Gain 0.06 — quiet but
// audible. Low-passed noise burst is the body; tiny sine pluck adds heel.
let _footFlip = false;
export function playFootstep() {
  const ctx = _audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  _footFlip = !_footFlip;

  // Low thud body — short noise through lowpass
  const dur = 0.08;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const lp    = ctx.createBiquadFilter();
  src.buffer = buf;
  lp.type = 'lowpass';
  lp.frequency.value = _footFlip ? 320 : 280;
  ngain.gain.setValueAtTime(0.06, t);
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp);
  lp.connect(ngain);
  ngain.connect(ctx.destination);
  src.start(t);

  // Tiny heel pluck — short sine drop
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(_footFlip ? 120 : 95, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.05);
  gain.gain.setValueAtTime(0.04, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.07);
}

// ── Bot shoot — raspy higher zap, clearly different from player's pow ──────
// Player uses a deep sine sweep 440→90Hz. Bots get a thinner, brighter sawtooth
// sweep 1100→380Hz with a crackle band, so you can tell incoming fire by ear.
export function playBotShoot() {
  const ctx = _audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Tone — sawtooth zap, higher and rasper than the player's sine
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1100, t);
  osc.frequency.exponentialRampToValueAtTime(380, t + 0.09);
  gain.gain.setValueAtTime(0.010, t); // softened twice: 0.055 → 0.022 → 0.010
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.11);

  // Crackle — short highpassed noise burst for that synthetic energy-weapon edge
  const dur = 0.05;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const hp    = ctx.createBiquadFilter();
  src.buffer = buf;
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  ngain.gain.setValueAtTime(0.005, t); // softened twice: 0.03 → 0.012 → 0.005
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp);
  hp.connect(ngain);
  ngain.connect(ctx.destination);
  src.start(t);
}

// ── Jump land — deeper, single thump on touchdown ──────────────────────────
export function playJumpLand() {
  const ctx = _audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  const dur = 0.13;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const lp    = ctx.createBiquadFilter();
  src.buffer = buf;
  lp.type = 'lowpass';
  lp.frequency.value = 200;
  ngain.gain.setValueAtTime(0.10, t);
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp);
  lp.connect(ngain);
  ngain.connect(ctx.destination);
  src.start(t);

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.10);
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}
