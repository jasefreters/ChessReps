// Calm board sounds, synthesised with the Web Audio API (no audio files).
// Pitched in the 500 Hz–2.5 kHz range so they're audible on laptop and phone
// speakers, with soft attacks and short fades so they stay gentle.

const KEY = 'book-moves:sound';
let ctx = null;
let master = null;
let enabled = readSetting();

function readSetting() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundOn() {
  return enabled;
}

export function setSound(on) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (on) unlock();
}

function makeChain(c) {
  const soften = c.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 5000;
  const out = c.createGain();
  out.gain.value = 0.8;
  out.connect(soften).connect(c.destination);
  return out;
}

function audio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = makeChain(ctx);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Browsers only allow sound after a click or key press, so start audio on the first one. */
function unlock() {
  const c = audio();
  if (!c) return;
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
  } catch { /* ignore */ }
}
if (typeof document !== 'undefined') {
  const once = () => {
    if (enabled) unlock();
    document.removeEventListener('pointerdown', once, true);
    document.removeEventListener('keydown', once, true);
  };
  document.addEventListener('pointerdown', once, true);
  document.addEventListener('keydown', once, true);
}

function tone(c, out, freq, { at = 0, dur = 0.5, gain = 0.1, type = 'sine', slideTo = null, attack = 0.01 } = {}) {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** A soft wood-block "tock": a short pitched knock plus a breath of filtered noise. */
function tap(c, out, at = 0, pitch = 1, gain = 1) {
  tone(c, out, 700 * pitch, { at, dur: 0.09, gain: 0.32 * gain, slideTo: 540 * pitch, attack: 0.002 });
  tone(c, out, 1400 * pitch, { at, dur: 0.035, gain: 0.07 * gain, type: 'triangle', attack: 0.001 });
  const len = Math.floor(c.sampleRate * 0.03);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400 * pitch;
  bp.Q.value = 1.5;
  const g = c.createGain();
  g.gain.value = 0.35 * gain;
  src.connect(bp).connect(g).connect(out);
  src.start(c.currentTime + at);
}

const SOUNDS = {
  move: (c, o) => tap(c, o),
  capture: (c, o) => { tap(c, o, 0, 0.85, 1.1); tap(c, o, 0.075, 0.75, 0.8); },
  check: (c, o) => { tap(c, o); tone(c, o, 880, { at: 0.04, dur: 0.55, gain: 0.12, type: 'triangle' }); },
  correct: (c, o) => {
    tone(c, o, 659.25, { at: 0.05, dur: 0.55, gain: 0.24 });
    tone(c, o, 987.77, { at: 0.17, dur: 0.8, gain: 0.21 });
  },
  wrong: (c, o) => tone(c, o, 440, { dur: 0.4, gain: 0.28, slideTo: 392, attack: 0.015 }),
  success: (c, o) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, f, { at: 0.06 + i * 0.11, dur: 1.0, gain: 0.17 }));
  },
};

export function play(name) {
  if (!enabled || !SOUNDS[name]) return;
  const c = audio();
  if (!c) return;
  try { SOUNDS[name](c, master); } catch { /* never let sound break the board */ }
}

/** Render a sound offline (used to check levels): resolves to its samples. */
export async function renderSound(name, seconds = 1.5) {
  const c = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
  SOUNDS[name](c, makeChain(c));
  const buf = await c.startRendering();
  return buf.getChannelData(0);
}
