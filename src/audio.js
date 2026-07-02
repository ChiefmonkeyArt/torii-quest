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

// ── Splash — real recorded water footstep (v0.2.335) ───────────────────────
// Plays back a real "footstep in water" splash MP3 instead of synthesized noise.
// Attribution: freesound.org sound #849638 ("footstep in water"), by user on
// https://freesound.org/ — used under its Creative Commons licence. The file
// lives at public/sounds/splash-footstep.wav (bundled into dist/). v0.2.338:
// converted to lossless WAV (PCM 16-bit, stereo, native rate) so the browser
// decodes it verbatim — the original low-sample-rate MP3 was being played back
// sped-up/truncated by decodeAudioData. The audio content is byte-for-byte the
// user-supplied recording; only the container changed.
//
// The MP3 is fetched + decoded ONCE into a cached AudioBuffer (`_splashBuf`);
// every subsequent step just spawns a cheap AudioBufferSourceNode (GC'd after
// stop, matching the other SFX). If decode fails, or on the very first call
// before the buffer is ready, we fall back to a short synthesized splash so a
// step is never silent.
let _splashBuf = null;       // decoded AudioBuffer once ready
let _splashPending = false;  // fetch/decode in flight (guards against re-fetch)
let _splashFailed = false;   // decode failed → always use synth fallback

function _loadSplash(ctx) {
  if (_splashBuf || _splashPending || _splashFailed) return;
  _splashPending = true;
  const url = `${import.meta.env.BASE_URL}sounds/splash-footstep.wav`;
  fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => { _splashBuf = decoded; _splashPending = false; })
    .catch(() => { _splashFailed = true; _splashPending = false; });
}

// Synthesized fallback splash — short filtered noise burst with a downward
// sweep, evoking a wet footstep. Used only on decode failure / first call.
function _synthSplash(ctx, t) {
  const dur = 0.18;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const bp    = ctx.createBiquadFilter();
  src.buffer = buf;
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1400, t);
  bp.frequency.exponentialRampToValueAtTime(500, t + dur);
  bp.Q.value = 0.6;
  ngain.gain.setValueAtTime(0.10, t);
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(ngain); ngain.connect(ctx.destination);
  src.start(t);
}

export function playSplash() {
  const ctx = _audioCtx();
  if (!ctx) return;
  if (_splashBuf) {
    const src  = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = _splashBuf;
    gain.gain.value = 0.12;
    src.connect(gain); gain.connect(ctx.destination);
    src.start();
    return;
  }
  // Not decoded yet — kick off the (one-time) load and play the synth this step.
  _loadSplash(ctx);
  _synthSplash(ctx, ctx.currentTime);
}

// ── Reload — snappy clunk-clunk-click (v0.2.113) ───────────────────────────
// User feedback: reload "felt dead" with no audio and a 2.0s window. We dropped
// the window to 1.1s AND give it a mechanical voice: two low "clunk"s (mag out,
// mag in) then a bright "click" (slide/charging handle). All scheduled off
// ctx.currentTime — NO setTimeout. Front-loaded so the action reads as snappy.
function _clunk(ctx, t, freq) {
  // Body — short lowpassed noise burst (the mechanical thud).
  const dur = 0.06;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const lp    = ctx.createBiquadFilter();
  src.buffer = buf;
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  ngain.gain.setValueAtTime(0.09, t);
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp); lp.connect(ngain); ngain.connect(ctx.destination);
  src.start(t);
  // Pitch drop — low sine pluck gives the clunk its weight.
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.05);
  gain.gain.setValueAtTime(0.05, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.07);
}
function _click(ctx, t) {
  // Bright, brief highpassed noise tick (the slide snapping home).
  const dur = 0.03;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const hp    = ctx.createBiquadFilter();
  src.buffer = buf;
  hp.type = 'highpass';
  hp.frequency.value = 2600;
  ngain.gain.setValueAtTime(0.06, t);
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp); hp.connect(ngain); ngain.connect(ctx.destination);
  src.start(t);
}
export function playReload() {
  const ctx = _audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  _clunk(ctx, t,        150); // mag out
  _clunk(ctx, t + 0.13, 190); // mag seats
  _click(ctx, t + 0.26);      // slide home
}

// ── Bot shoot — raspy higher zap, clearly different from player's pow ──────
// Player uses a deep sine sweep 440→90Hz. Bots get a thinner, brighter sawtooth
// sweep 1100→380Hz with a crackle band, so you can tell incoming fire by ear.
export function playBotShoot() {
  const ctx = _audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  // Tone — softer triangle zap (v0.2.102). Triangle is mellower than sawtooth;
  // a gentle attack ramp + longer tail removes the harsh click of the old
  // sawtooth while staying distinct from the player's deeper sine pow.
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(720, t);
  osc.frequency.exponentialRampToValueAtTime(200, t + 0.12);
  gain.gain.setValueAtTime(1e-4, t);
  gain.gain.linearRampToValueAtTime(0.035, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(1e-4, t + 0.18);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);

  // Body — short lowpassed noise burst for a soft energy thump (no crackle).
  const dur = 0.04;
  const sr  = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const ch  = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src   = ctx.createBufferSource();
  const ngain = ctx.createGain();
  const lp    = ctx.createBiquadFilter();
  src.buffer = buf;
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  ngain.gain.setValueAtTime(0.004, t);
  ngain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp);
  lp.connect(ngain);
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
