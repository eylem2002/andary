import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEAR, createTownWeather, createWeatherDriver } from '../../../public/js/core/town-weather.js';
import { weatherSky } from '../../../public/js/world/env/weather-sky.js';
import { skyState } from '../../../public/js/world/env/daynight.js';

/** @returns {any} a town event, as much of one as the weather reads */
const ev = (/** @type {string} */ kind, /** @type {number} */ ts, data = {}, sessionId = 's1') => ({ kind, ts, sessionId, data });

test('a clear town stays clear', () => {
  assert.deepEqual(createTownWeather().at(0), { ...CLEAR });
});

test('failures bring rain that fades, and a pile of them a storm', () => {
  const w = createTownWeather();
  w.observe(ev('tool.fail', 0, { errorKind: 'generic' }));
  assert.equal(w.at(0).kind, 'rain');
  assert.ok(w.at(0).rain > 0 && w.at(0).rain < 0.5);
  assert.equal(w.at(10 * 60_000).kind, 'clear', 'it fades away');
  for (let i = 0; i < 4; i += 1) w.observe(ev('tool.fail', 20 * 60_000, { commandKind: 'test' }));
  const storm = w.at(20 * 60_000);
  assert.equal(storm.kind, 'storm');
  assert.equal(storm.storm, true);
  assert.ok(storm.rain >= 0.85);
  w.observe(ev('tool.fail', 21 * 60_000, { errorKind: 'interrupted' }));
});

test('interrupts do not rain, a failed turn storms for a while', () => {
  const w = createTownWeather();
  w.observe(ev('tool.fail', 0, { errorKind: 'interrupted', isInterrupt: true }));
  assert.equal(w.at(0).kind, 'clear');
  w.observe(ev('turn.fail', 0));
  assert.equal(w.at(30_000).kind, 'storm');
  assert.notEqual(w.at(50_000).kind, 'storm');
});

test('tests that pass again after failing bring a rainbow and wash most of the rain away', () => {
  const w = createTownWeather();
  w.observe(ev('tool.fail', 0, { commandKind: 'test' }));
  w.observe(ev('tool.fail', 1000, { commandKind: 'test' }));
  assert.equal(w.at(2000).kind, 'rain');
  w.observe(ev('tool.end', 3000, { commandKind: 'test' }));
  const after = w.at(5000);
  assert.ok(after.rainbow > 0.9);
  assert.equal(after.kind, 'rainbow');
  assert.equal(w.at(40_000).rainbow, 0, 'it goes after half a minute');
  w.observe(ev('tool.end', 50_000, { commandKind: 'test' }));
  assert.equal(w.at(52_000).rainbow, 0, 'passing tests that never failed bring no rainbow');
  w.observe(ev('tool.fail', 60_000, { commandKind: 'test' }, 's2'));
  w.observe(ev('tool.end', 61_000, { commandKind: 'test' }, 's1'));
  assert.equal(w.at(62_000).rainbow, 0, 'only the crew whose tests failed');
});

test('long thinking without tools brings fog; a tool or a stop clears it', () => {
  const w = createTownWeather();
  w.observe(ev('prompt', 0));
  assert.equal(w.at(20_000).fog, 0);
  assert.equal(w.at(60_000).kind, 'fog');
  assert.equal(w.at(200_000).fog, 0.8);
  w.observe(ev('tool.start', 200_000));
  assert.equal(w.at(200_001).fog, 0);
  w.observe(ev('prompt', 300_000));
  w.observe(ev('turn.stop', 301_000));
  assert.equal(w.at(400_000).fog, 0);
});

test('the driver tells the world only about changes, and stays clear when turned off', () => {
  /** @type {(change: any) => void} */
  let listener = () => {};
  const store = { subscribe: (fn) => ((listener = fn), () => {}) };
  const sent = [];
  const kinds = [];
  let on = true;
  let now = 0;
  const driver = createWeatherDriver({ store, world: () => ({ setTownWeather: (w) => sent.push(w) }), onChange: (w) => kinds.push(w.kind), now: () => now, enabled: () => on });
  driver.tick();
  assert.equal(sent.length, 0);
  listener({ type: 'event', event: ev('turn.fail', 0) });
  driver.tick();
  driver.tick();
  assert.equal(sent.length, 1);
  assert.equal(driver.current.kind, 'storm');
  on = false;
  driver.tick();
  assert.equal(sent.at(-1).kind, 'clear');
  on = true;
  listener({ type: 'reset' });
  now = 1;
  driver.tick();
  assert.deepEqual(kinds, ['storm', 'clear']);
  driver.dispose();
});

test('weatherSky greys and dims the sky and pulls the fog in', () => {
  const day = skyState(13);
  assert.equal(weatherSky(day, { overcast: 0, fog: 0 }).fogScale, 1);
  assert.deepEqual(weatherSky(day, { overcast: 0, fog: 0 }).zenith, day.zenith);
  const grey = weatherSky(day, { overcast: 1, fog: 0 });
  assert.ok(grey.lightIntensity < day.lightIntensity * 0.5);
  const spread = (rgb) => Math.max(...rgb) - Math.min(...rgb);
  assert.ok(spread(grey.zenith) < spread(day.zenith), 'less colourful');
  const foggy = weatherSky(day, { overcast: 0, fog: 1 });
  assert.ok(foggy.fogScale < 0.3);
  assert.equal(weatherSky(skyState(23), { overcast: 1, fog: 0 }).stars, 0, 'no stars behind clouds');
});
