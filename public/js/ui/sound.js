// Sound effects, synthesised with WebAudio (no audio files). Off by default. Browsers only let an
// AudioContext start inside a user gesture, so the context is created when the viewer turns sound
// on (a click or key press) or, if sound was left on last time, at their first gesture on the page.

/** @typedef {'pop'|'chime'|'buzz'|'bell'|'whoosh'} SoundName */

/** Minimum gap between two plays of the same sound, so bursts of events don't become noise. */
const MIN_GAP_MS = { pop: 140, chime: 900, buzz: 1600, bell: 1200, whoosh: 1200 };
const MAX_PER_SECOND = 6;

/**
 * @param {{ enabled?: boolean, volume?: number }} [options]
 */
export function createSound({ enabled = false, volume = 0.6 } = {}) {
  /** @type {AudioContext|null} */
  let ctx = null;
  /** @type {GainNode|null} */
  let master = null;
  let on = enabled;
  let level = volume;
  /** @type {Record<string, number>} */
  const lastPlayed = {};
  /** @type {number[]} */
  let recent = [];

  /** Creates or resumes the context; must run inside a user gesture the first time. */
  function wake() {
    if (!ctx) {
      const AudioCtor = globalThis.AudioContext ?? /** @type {any} */ (globalThis).webkitAudioContext;
      if (!AudioCtor) return;
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = level * 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  /** @param {SoundName} name */
  function allowed(name) {
    const now = performance.now();
    if (now - (lastPlayed[name] ?? -Infinity) < MIN_GAP_MS[name]) return false;
    recent = recent.filter((t) => now - t < 1000);
    if (recent.length >= MAX_PER_SECOND) return false;
    lastPlayed[name] = now;
    recent.push(now);
    return true;
  }

  return {
    get enabled() {
      return on;
    },
    /** Call from a click or key handler so the browser lets audio start. @param {boolean} value */
    setEnabled(value) {
      on = value;
      if (on) wake();
    },
    /** Called on the first user gesture when sound was already on at load. */
    unlock() {
      if (on) wake();
    },
    /** @param {number} value 0–1 */
    setVolume(value) {
      level = value;
      if (master) master.gain.value = level * 0.5;
    },
    /** @param {SoundName} name */
    play(name) {
      if (!on || !ctx || !master || ctx.state !== 'running' || !SYNTHS[name] || !allowed(name)) return;
      SYNTHS[name](ctx, master);
    },
  };
}

/**
 * One enveloped oscillator note.
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 * @param {{ type?: OscillatorType, freq: number, to?: number, at?: number, dur: number, gain?: number }} note
 */
function tone(ctx, out, { type = 'sine', freq, to, at = 0, dur, gain = 0.3 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur * 0.8);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** @type {Record<SoundName, (ctx: AudioContext, out: AudioNode) => void>} */
const SYNTHS = {
  // A new agent pops into town.
  pop: (ctx, out) => tone(ctx, out, { freq: 520, to: 900, dur: 0.09, gain: 0.25 }),
  // Achievements: a rising major third.
  chime: (ctx, out) => {
    tone(ctx, out, { freq: 880, dur: 0.45, gain: 0.18 });
    tone(ctx, out, { freq: 1108.7, at: 0.09, dur: 0.6, gain: 0.16 });
  },
  // Failures: short and low, unmistakable without being alarming.
  buzz: (ctx, out) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(out);
    tone(ctx, filter, { type: 'sawtooth', freq: 140, to: 110, dur: 0.2, gain: 0.16 });
  },
  // Approvals: a counter bell with one overtone.
  bell: (ctx, out) => {
    tone(ctx, out, { type: 'triangle', freq: 1046.5, dur: 1.1, gain: 0.22 });
    tone(ctx, out, { freq: 2093, dur: 0.6, gain: 0.06 });
  },
  // A crew arrives: band-passed noise sweeping upwards.
  whoosh: (ctx, out) => {
    const dur = 0.42;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    const start = ctx.currentTime;
    band.frequency.setValueAtTime(380, start);
    band.frequency.exponentialRampToValueAtTime(2400, start + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.22, start + 0.12);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    noise.connect(band).connect(env).connect(out);
    noise.start(start);
  },
};
