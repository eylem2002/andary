import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ambientMix, createAmbient } from '../../../public/js/ui/ambient.js';

test('the mix follows the work, the hour and the rain', () => {
  const quiet = ambientMix({ activity: 0, night: false, rain: 0 });
  const busy = ambientMix({ activity: 1, night: false, rain: 0 });
  assert.ok(busy.hum > quiet.hum && busy.pad > quiet.pad);
  assert.equal(quiet.gulls, 1);
  assert.equal(quiet.crickets, 0);
  const night = ambientMix({ activity: 0, night: true, rain: 0 });
  assert.equal(night.gulls, 0);
  assert.equal(night.crickets, 1);
  const wet = ambientMix({ activity: 2, night: false, rain: 1 });
  assert.equal(wet.rain, 0.8);
  assert.equal(wet.gulls, 0, 'no gulls in the rain');
  assert.equal(wet.hum, ambientMix({ activity: 1, night: false, rain: 1 }).hum, 'activity is capped at 1');
});

/** Just enough of WebAudio to build the graph and count what starts. */
function fakeAudio() {
  const started = { sources: 0, oscillators: 0 };
  const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param() }),
    createOscillator: () => node({ type: '', frequency: param(), detune: param(), start: () => (started.oscillators += 1), stop() {} }),
    createBufferSource: () => node({ buffer: null, loop: false, start: () => (started.sources += 1) }),
    createBuffer: (_c, length) => ({ getChannelData: () => new Float32Array(length) }),
  };
  return { ctx: /** @type {any} */ (ctx), started };
}

test('the ambient bed builds its layers once, schedules while playing and stops cleanly', async () => {
  const { ctx, started } = fakeAudio();
  const ambient = createAmbient(ctx, /** @type {any} */ ({}));
  assert.equal(started.sources, 3, 'waves, hum and rain loops');
  ambient.setMood({ activity: 0.5, night: false, rain: 0 });
  ambient.setPlaying(true);
  assert.equal(ambient.playing, true);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(started.oscillators >= 4, 'a chord started');
  ambient.setPlaying(false);
  const after = started.oscillators;
  ctx.currentTime = 100;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(started.oscillators, after, 'nothing new while stopped');
  ambient.dispose();
});
