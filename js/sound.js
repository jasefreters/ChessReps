// Calm board sounds, synthesised with the Web Audio API (no audio files).
// Everything runs through one quiet master gain and a soft low-pass filter.

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
}

function audio() {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 3200;
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(soften).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** A tone with a soft attack and a long, gentle fade. */
function tone(freq, { at = 0, dur = 0.5, gain = 0.06, type = 'sine', slideTo = null, attack = 0.012 } = {}) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** A short wooden "tock": a falling low sine plus a breath of filtered noise. */
function tap(at = 0, pitch = 1, gain = 1) {
  const t0 = ctx.currentTime + at;
  tone(210 * pitch, { at, dur: 0.11, gain: 0.16 * gain, slideTo: 140 * pitch, attack: 0.003 });
  const len = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500 * pitch;
  bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = 0.09 * gain;
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
}

const SOUNDS = {
  move: () => tap(),
  capture: () => { tap(0, 0.85, 1.1); tap(0.07, 0.8, 0.7); },
  check: () => { tap(); tone(784, { at: 0.03, dur: 0.45, gain: 0.035, type: 'triangle' }); },
  correct: () => { tone(523.25, { at: 0.05, dur: 0.5, gain: 0.05 }); tone(783.99, { at: 0.16, dur: 0.7, gain: 0.045 }); },
  wrong: () => tone(220, { dur: 0.38, gain: 0.06, slideTo: 185, attack: 0.02 }),
  success: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { at: 0.06 + i * 0.11, dur: 0.9, gain: 0.04 }));
  },
};

export function play(name) {
  if (!audio() || !SOUNDS[name]) return;
  try { SOUNDS[name](); } catch { /* never let sound break the board */ }
}
