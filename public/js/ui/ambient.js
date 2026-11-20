// Ambient sound for the town, synthesised (no audio files): waves on the shore, a city hum that
// grows with the work, gulls by day and crickets by night, rain when the town's weather rains,
// and a soft pad of slow chords that gets a little fuller when the crews are busy. It plays only
// while sound is on and "Ambient sound" is on in Settings, and fades out when the tab is hidden.

/**
 * @typedef {object} AmbientMood
 * @property {number} activity  0–1, how busy the town is
 * @property {boolean} night
 * @property {number} rain      0–1
 */

/** Chords of the pad (Hz): Cmaj7, Am7, Fmaj7, G6 in a low, soft voicing. */
const CHORDS = [
  [130.81, 196.0, 246.94, 329.63],
  [110.0, 164.81, 196.0, 261.63],
  [87.31, 130.81, 164.81, 220.0],
  [98.0, 146.83, 196.0, 246.94],
];
const CHORD_SECONDS = 8;

/**
 * The mix for a mood: how loud each layer is (0–1, before the ambient volume).
 * @param {AmbientMood} mood
 */
export function ambientMix({ activity, night, rain }) {
  const a = Math.min(1, Math.max(0, activity || 0));
  const r = Math.min(1, Math.max(0, rain || 0));
  return {
    waves: 0.55,
    hum: night ? 0.12 + 0.25 * a : 0.2 + 0.4 * a,
    pad: 0.25 + 0.45 * a,
    rain: r * 0.8,
    gulls: night ? 0 : 1 - r,
    crickets: night ? 1 - r : 0,
  };
}

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 */
export function createAmbient(ctx, out) {
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  /** @type {AudioScheduledSourceNode[]} the loops, stopped on dispose */
  const sources = [];
  const layers = {
    waves: waves(ctx, bus, sources),
    hum: noiseLayer(ctx, bus, { type: 'lowpass', freq: 220, brown: true }, sources),
    rain: noiseLayer(ctx, bus, { type: 'highpass', freq: 1800, brown: false }, sources),
    pad: ctx.createGain(),
  };
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 900;
  layers.pad.connect(padFilter).connect(bus);
  let mix = ambientMix({ activity: 0, night: false, rain: 0 });
  let chord = 0;
  let nextChord = ctx.currentTime;
  let nextCall = ctx.currentTime + 4;
  let running = false;
  /** @type {ReturnType<typeof setInterval>|null} */
  let timer = null;

  /** Plays the next chord, and a gull or a cricket when one is due. */
  function schedule() {
    const now = ctx.currentTime;
    if (now + 0.5 >= nextChord) {
      playChord(ctx, layers.pad, CHORDS[chord % CHORDS.length], nextChord);
      chord += 1;
      nextChord += CHORD_SECONDS;
    }
    if (now >= nextCall) {
      if (mix.gulls > 0.2) gull(ctx, bus, now, 0.05 * mix.gulls);
      if (mix.crickets > 0.2) crickets(ctx, bus, now, 0.012 * mix.crickets);
      nextCall = now + (mix.crickets > 0.2 ? 1.6 + Math.random() * 1.4 : 7 + Math.random() * 12);
    }
  }

  /** @param {AudioParam} param @param {number} value */
  const glide = (param, value) => param.setTargetAtTime(value, ctx.currentTime, 1.2);

  return {
    /** @param {AmbientMood} mood */
    setMood(mood) {
      mix = ambientMix(mood);
      glide(layers.waves.gain, 0.09 * mix.waves);
      glide(layers.hum.gain, 0.08 * mix.hum);
      glide(layers.rain.gain, 0.06 * mix.rain);
      glide(layers.pad.gain, 0.045 * mix.pad);
    },
    /** @param {boolean} on */
    setPlaying(on) {
      if (on === running) return;
      running = on;
      glide(bus.gain, on ? 0.7 : 0);
      if (on && !timer) {
        nextChord = Math.max(nextChord, ctx.currentTime + 0.2);
        timer = setInterval(schedule, 250);
      } else if (!on && timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    get playing() {
      return running;
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
      running = false;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // already stopped
        }
      }
      bus.disconnect();
    },
  };
}

/**
 * Looped noise through a filter.
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 * @param {{ type: BiquadFilterType, freq: number, brown: boolean }} options
 * @param {AudioScheduledSourceNode[]} sources
 */
function noiseLayer(ctx, out, { type, freq, brown }, sources) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 4, brown);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(out);
  source.start();
  sources.push(source);
  return gain;
}

/**
 * Waves: brown noise whose loudness and brightness rise and fall like surf.
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 * @param {AudioScheduledSourceNode[]} sources
 */
function waves(ctx, out, sources) {
  const gain = noiseLayer(ctx, out, { type: 'lowpass', freq: 520, brown: true }, sources);
  const swell = ctx.createGain();
  swell.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.09;
  const depth = ctx.createGain();
  depth.gain.value = 0.4;
  lfo.connect(depth).connect(swell.gain);
  lfo.start();
  sources.push(lfo);
  // Re-route the layer through the swell.
  gain.disconnect();
  gain.connect(swell).connect(out);
  return gain;
}

/**
 * @param {AudioContext} ctx
 * @param {number} seconds
 * @param {boolean} brown  brown (deep) or white noise
 */
function noiseBuffer(ctx, seconds, brown) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

/**
 * One soft chord: slow attack, held, slow release, with a gentle detune for warmth.
 * @param {AudioContext} ctx
 * @param {AudioNode} out
 * @param {number[]} freqs
 * @param {number} at
 */
function playChord(ctx, out, freqs, at) {
  for (const [i, freq] of freqs.entries()) {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = (i % 2 ? 4 : -4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(i === 0 ? 0.5 : 0.28, at + 2.5);
    env.gain.setValueAtTime(i === 0 ? 0.5 : 0.28, at + CHORD_SECONDS - 2);
    env.gain.exponentialRampToValueAtTime(0.0001, at + CHORD_SECONDS + 1.5);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + CHORD_SECONDS + 1.6);
  }
}

/**
 * A gull: two falling cries with a little warble.
 * @param {AudioContext} ctx @param {AudioNode} out @param {number} at @param {number} level
 */
function gull(ctx, out, at, level) {
  for (const [offset, from, to] of [[0, 1900, 1250], [0.32, 2050, 1300]]) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const start = at + offset;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + 0.24);
    const warble = ctx.createOscillator();
    warble.frequency.value = 28;
    const warbleDepth = ctx.createGain();
    warbleDepth.gain.value = 40;
    warble.connect(warbleDepth).connect(osc.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(level, start + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
    osc.connect(env).connect(out);
    for (const node of [osc, warble]) {
      node.start(start);
      node.stop(start + 0.3);
    }
  }
}

/**
 * Crickets: a few quick high pulses.
 * @param {AudioContext} ctx @param {AudioNode} out @param {number} at @param {number} level
 */
function crickets(ctx, out, at, level) {
  for (let i = 0; i < 3; i++) {
    const start = at + i * 0.07;
    const osc = ctx.createOscillator();
    osc.frequency.value = 4400;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(level, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(start + 0.06);
  }
}
