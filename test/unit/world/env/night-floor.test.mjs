// The time-of-day maths at every hour, in other time zones and across DST changes, with bad input,
// and the night floor that keeps the town readable whatever the hour, look or weather.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  NIGHT_FLOOR,
  hourFromDate,
  linearLuminance,
  moonPosition,
  normalizeHour,
  readable,
  skyKeysFor,
  skyState,
  sunPosition,
} from '../../../../public/js/world/env/daynight.js';
import { weatherSky } from '../../../../public/js/world/env/weather-sky.js';
import { GUARD, meanLuma, nextGain } from '../../../../public/js/world/env/brightness-guard.js';
import { LOOKS } from '../../../../public/js/core/looks.js';

const DAYNIGHT = fileURLToPath(new URL('../../../../public/js/world/env/daynight.js', import.meta.url));
const WORST = [
  { overcast: 0, fog: 0 },
  { overcast: 1, fog: 0 },
  { overcast: 0.4, fog: 0.8 },
  { overcast: 1, fog: 1 },
];
const finite = (/** @type {number[]} */ v) => v.every(Number.isFinite);

test('skyState is finite and sane at every quarter hour', () => {
  for (let h = 0; h < 24; h += 0.25) {
    const s = skyState(h);
    for (const key of ['zenith', 'horizon', 'bottom', 'fog', 'light', 'hemiSky', 'hemiGround', 'lightDir']) assert.ok(finite(s[key]), `${key} at ${h}`);
    for (const key of ['lightIntensity', 'hemiIntensity', 'envIntensity', 'night', 'late', 'stars', 'bloom', 'bloomThreshold', 'exposure']) {
      assert.ok(Number.isFinite(s[key]) && s[key] >= 0, `${key} at ${h}`);
    }
    assert.ok(Math.abs(Math.hypot(...s.lightDir) - 1) < 1e-9, `lightDir is a unit vector at ${h}`);
    assert.ok(s.lightDir[1] > 0.2, `the key light is above the town at ${h}`);
    assert.ok(s.exposure >= 1.1 && s.exposure <= 1.3);
  }
});

test('bad hours never reach the renderer as NaN', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, undefined, null, '23', -0.0001, 24, 1e12, -1e12]) {
    const h = normalizeHour(/** @type {any} */ (bad));
    assert.ok(h >= 0 && h < 24, `normalizeHour(${bad})`);
    const s = readable(weatherSky(skyState(/** @type {any} */ (bad)), { overcast: 1, fog: 1 }));
    assert.ok(finite(s.lightDir) && Number.isFinite(s.hemiIntensity) && Number.isFinite(s.lightIntensity), `skyState(${bad})`);
    assert.ok(finite(sunPosition(/** @type {any} */ (bad)).dir) && finite(moonPosition(/** @type {any} */ (bad)).dir));
  }
  // An invalid Date (a broken clock) gives NaN hours, which normalise to midday rather than NaN.
  assert.ok(Number.isNaN(hourFromDate(new Date('not a date'))));
  assert.equal(normalizeHour(hourFromDate(new Date('not a date'))), 12);
});

/** The town's hour for an instant, as a browser in `tz` would compute it. */
function hourIn(tz, iso) {
  const code = `import('${DAYNIGHT.replace(/\\/g, '/')}').then((m) => process.stdout.write(String(m.hourFromDate(new Date('${iso}')))))`;
  return Number(execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: tz } }).toString());
}

test('hourFromDate follows the local clock in other time zones and across DST changes', { skip: process.platform === 'win32' && 'Windows ignores IANA names in TZ' }, () => {
  // Amman is UTC+3 all year (no DST since 2022): 20:00 UTC is 23:00 there.
  assert.equal(hourIn('Asia/Amman', '2026-11-22T20:00:00Z'), 23);
  assert.equal(hourIn('Asia/Amman', '2026-07-01T18:30:00Z'), 21.5);
  // New York springs forward at 02:00 local: 01:59 EST is followed by 03:00 EDT.
  assert.ok(Math.abs(hourIn('America/New_York', '2026-03-08T06:59:00Z') - (1 + 59 / 60)) < 1e-9);
  assert.equal(hourIn('America/New_York', '2026-03-08T07:00:00Z'), 3);
  // London falls back at 02:00 BST: 01:59 BST is followed by 01:00 GMT again.
  assert.ok(Math.abs(hourIn('Europe/London', '2026-10-25T00:59:00Z') - (1 + 59 / 60)) < 1e-9);
  assert.equal(hourIn('Europe/London', '2026-10-25T01:00:00Z'), 1);
  // Half-hour and 45-minute zones.
  assert.equal(hourIn('Asia/Kolkata', '2026-11-22T17:30:00Z'), 23);
  assert.equal(hourIn('Asia/Kathmandu', '2026-11-22T17:15:00Z'), 23);
  // Whatever the jump, the sky stays finite on both sides of it.
  for (const h of [1 + 59 / 60, 3, 1]) assert.ok(finite(skyState(h).lightDir));
});

/** Fill and key luminance of a state, as three.js lights it (linear). */
const fill = (/** @type {any} */ s) => linearLuminance(s.hemiSky) * s.hemiIntensity;
const key = (/** @type {any} */ s) => linearLuminance(s.light) * s.lightIntensity;

test('the night floor holds at every hour and in the worst weather', () => {
  for (let h = 0; h < 24; h += 0.25) {
    for (const w of WORST) {
      const s = readable(weatherSky(skyState(h), w));
      assert.ok(fill(s) >= NIGHT_FLOOR.fill - 1e-9, `fill at ${h} in ${JSON.stringify(w)}: ${fill(s).toFixed(3)}`);
      if (!s.sunUp && s.night >= 1) assert.ok(key(s) >= NIGHT_FLOOR.key - 1e-9, `moonlight at ${h} in ${JSON.stringify(w)}`);
    }
  }
});

test('the night floor never dims anything and leaves the day alone', () => {
  for (let h = 0; h < 24; h += 0.5) {
    const s = skyState(h);
    const r = readable(s);
    assert.ok(r.hemiIntensity >= s.hemiIntensity && r.lightIntensity >= s.lightIntensity);
  }
  const noon = skyState(12.5);
  assert.equal(readable(noon), noon, 'nothing to lift at noon');
});

test('the key light still fades out where it switches between sun and moon', () => {
  for (let h = 0; h < 24; h += 0.01) {
    const a = readable(skyState(h));
    const b = readable(skyState(h + 0.01));
    if (a.sunUp !== b.sunUp) assert.ok(a.lightIntensity < 0.05 && b.lightIntensity < 0.05, `switch at ${h}`);
  }
});

test('the floor holds for every town look', () => {
  for (const look of Object.keys(LOOKS)) {
    for (const k of skyKeysFor(/** @type {any} */ (look))) {
      const state = /** @type {any} */ ({ ...skyState(0), hemiSky: k.hemiSky.match(/\w\w/g).map((x) => parseInt(x, 16) / 255), light: k.light.match(/\w\w/g).map((x) => parseInt(x, 16) / 255), hemiIntensity: k.hemiI, lightIntensity: k.lightI, night: k.night, sunUp: false });
      assert.ok(fill(readable(state)) >= NIGHT_FLOOR.fill - 1e-9, `${look} at ${k.h}`);
    }
  }
});

test('night fog is a haze, not a black wall', () => {
  const night = skyState(23);
  const foggy = weatherSky(night, { overcast: 0.4, fog: 0.8 });
  assert.ok(linearLuminance(foggy.fog) >= linearLuminance(night.horizon) * 0.8, 'fog no darker than the night horizon');
  assert.ok(foggy.fogScale > weatherSky(skyState(12), { overcast: 0.4, fog: 0.8 }).fogScale, 'fog thinner at night than by day');
});

test('brightness guard: lifts a dark frame, caps the lift, eases back, ignores garbage', () => {
  assert.equal(nextGain(1, 120), 1, 'a bright frame needs nothing');
  const lifted = nextGain(1, 30);
  assert.ok(lifted > 1 && lifted <= GUARD.maxGain);
  let g = 1;
  for (let i = 0; i < 20; i++) g = nextGain(g, 5);
  assert.equal(g, GUARD.maxGain, 'never past the cap');
  assert.ok(nextGain(1.5, 140) < 1.5 && nextGain(1.5, 140) >= 1, 'eases back once bright');
  assert.equal(nextGain(1, GUARD.min + 1), 1, 'no hunting just above the floor');
  assert.equal(nextGain(1.3, 0), 1.3, 'an all-black frame (nothing drawn) says nothing');
  assert.equal(nextGain(1.3, Number.NaN), 1.3);
  assert.equal(nextGain(Number.NaN, 30) > 1, true);
  assert.ok(Math.abs(meanLuma([255, 255, 255, 255, 0, 0, 0, 255]) - 127.5) < 1e-9);
  assert.equal(meanLuma([]), 0);
});
