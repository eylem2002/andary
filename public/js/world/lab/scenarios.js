// Scripted lab scenarios, chosen with ?scenario=… so a screenshot can show close-ups of every
// hat, accessory, activity, bubble tone and effect, or a busy crowd.

import { BUILDING_ACTIVITY, BUILDING_KEYS, CREW_COLORS } from '../../core/catalog.js';
import { ACTIVITY_NAMES } from '../agents/activities.js';
import { EFFECT_KINDS } from '../agents/effects.js';

/** Agent templates the lab can spawn: one per role and a few custom types. */
export const TEMPLATES = Object.freeze({
  foreman: { role: 'lead', name: 'Foreman' },
  scout: { role: 'subagent', type: 'Explore', name: 'Scout' },
  architect: { role: 'subagent', type: 'Plan', name: 'Architect' },
  builder: { role: 'subagent', type: 'general-purpose', name: 'Builder' },
  teammate: { role: 'teammate', type: 'general-purpose', name: 'Rania' },
  reviewer: { role: 'subagent', type: 'code-reviewer', name: 'Reviewer' },
  tester: { role: 'subagent', type: 'test-runner', name: 'Tester' },
  writer: { role: 'subagent', type: 'docs-writer', name: 'Scribe' },
  debugger: { role: 'subagent', type: 'debugger', name: 'Debugger' },
  researcher: { role: 'subagent', type: 'web-researcher', name: 'Researcher' },
  custom: { role: 'subagent', type: 'statusline-setup', name: 'Statusline Setup' },
});

const LINES = {
  speech: ['Reading src/auth/login.ts', 'Found 3 TODOs in api/', 'Tests are green!', 'On my way to the library'],
  thought: ['Hmm, where is that config…', 'Maybe a race condition?', 'Should I refactor this?'],
  shout: ['Build failed!', 'Need approval!', 'Ship it!'],
  code: ['$ npm test', 'git commit -m "fix: auth"', 'grep -rn "TODO" src', '$ ls -la'],
};
const TONES = Object.keys(LINES);

/** @param {readonly any[]} list */
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * @typedef {object} Lab
 * @property {any} world
 * @property {(template: string, overrides?: object) => string} spawn
 * @property {(id: string, x: number, z: number, yaw?: number) => void} place
 * @property {(ms: number, fn: () => void) => void} every
 * @property {(ms: number, fn: () => void) => void} after
 * @property {string[]} ids
 * @property {number|null} zoom   zoom from the URL, if any
 * @property {number|null} at     index of the agent a close-up should centre on, from the URL
 * @property {string|null} face   line-up facing from the URL: 'back' or 'north'
 */

/** The south ring road (row 23) has nothing taller than trees between it and the camera. */
const STAGE_Z = 21;
const FACE_CAMERA = Math.PI / 4;

/** Centres the camera on one of `ids` (the URL's `at`, else `fallback`) and zooms in. @param {Lab} lab @param {string[]} ids */
function closeUp(lab, ids, fallback, zoom) {
  const id = ids[lab.at ?? fallback] ?? ids[fallback];
  lab.after(60, () => {
    lab.world.focusAgent(id);
    lab.world.zoomBy(lab.zoom ?? zoom);
  });
}

/** Every hat and every accessory, side by side, facing the camera. @param {Lab} lab */
function lineup(lab) {
  const cast = [
    ['foreman', 'hardhat'],
    ['scout', 'cap'],
    ['architect', 'crown'],
    ['builder', 'beret'],
    ['teammate', 'sunhat'],
    ['reviewer', 'wizard'],
    ['tester', 'none'],
    ['writer', 'cap'],
    ['debugger', 'crown'],
    ['researcher', 'sunhat'],
    ['custom', 'beret'],
  ];
  const ids = cast.map(([template, hat], i) => {
    const id = lab.spawn(template, { hat, entrance: 'none', color: CREW_COLORS[i % CREW_COLORS.length] });
    lab.place(id, (i - (cast.length - 1) / 2) * 1.15, STAGE_Z + (i % 2) * 0.35, facing(lab));
    return id;
  });
  closeUp(lab, ids, Math.floor(ids.length / 2), 3.2);
}

/** Every activity at once, labelled. @param {Lab} lab */
function activities(lab) {
  const perRow = 9;
  const ids = ACTIVITY_NAMES.map((activity, i) => {
    const template = Object.keys(TEMPLATES)[i % 6];
    const id = lab.spawn(template, { name: activity, entrance: 'none', color: CREW_COLORS[i % CREW_COLORS.length] });
    const row = Math.floor(i / perRow);
    lab.place(id, ((i % perRow) - (perRow - 1) / 2) * 1.5 + row * 0.75, STAGE_Z - 0.6 + row * 1.25, facing(lab));
    lab.world.setActivity(id, activity);
    lab.world.setStatus(id, ['working', 'waiting', 'idle', 'error', 'done'][i % 5]);
    return id;
  });
  closeUp(lab, ids, 4, 2.3);
}

/** Bubble tones, truncation, de-overlap, badges, statuses and emotes. @param {Lab} lab */
function bubbles(lab) {
  const ids = ['foreman', 'scout', 'architect', 'builder', 'teammate', 'tester'].map((template, i) => {
    const id = lab.spawn(template, { entrance: 'none', color: CREW_COLORS[i] });
    lab.place(id, (i - 2.5) * 0.95, STAGE_Z + (i % 2) * 0.5, FACE_CAMERA);
    lab.world.setStatus(id, ['working', 'waiting', 'idle', 'error', 'done', 'working'][i]);
    return id;
  });
  lab.world.setBadge(ids[0], '×4');
  lab.world.setBadge(ids[3], '2 tasks');
  const talk = () => {
    ids.forEach((id, i) => {
      const tone = TONES[i % TONES.length];
      const long = 'Searching the whole repository for every place that still calls the old payment client before the migration lands next week';
      lab.world.say(id, i === 4 ? long : pick(LINES[tone]), { tone, ms: 6000 });
    });
  };
  talk();
  lab.every(5000, talk);
  lab.after(400, () => ['🎉', '💡', '😅'].forEach((e, i) => lab.world.emote(ids[i * 2], e)));
  lab.every(2500, () => lab.world.emote(pick(ids), pick(['🎉', '💡', '😅', '🔥', '✅', '🤔'])));
  closeUp(lab, ids, 2, 3);
}

/** Every effect, each on its own labelled agent, on a loop; and some on buildings. @param {Lab} lab */
function effects(lab) {
  const perRow = 8;
  const ids = EFFECT_KINDS.map((kind, i) => {
    const id = lab.spawn(Object.keys(TEMPLATES)[i % 6], { name: kind, entrance: 'none', color: CREW_COLORS[i % 8] });
    const row = Math.floor(i / perRow);
    lab.place(id, ((i % perRow) - (perRow - 1) / 2) * 1.7 + row * 0.85, STAGE_Z - 0.6 + row * 1.3, FACE_CAMERA);
    return id;
  });
  const fire = () => ids.forEach((id, i) => lab.world.effect(EFFECT_KINDS[i], { agent: id }));
  lab.after(300, fire);
  lab.every(2600, fire);
  lab.every(3000, () => {
    lab.world.effect('fireworks', { building: 'hall' });
    lab.world.effect('smoke', { building: 'terminal' });
    lab.world.effect('signal', { building: 'web' });
    lab.world.effect('boxes', { building: 'post' });
  });
  closeUp(lab, ids, 3, 2.2);
}

/** Facing for line-ups: toward the camera by default; ?face=back turns away from it, ?face=north faces
 * the way agents at a work spot do (a 3/4 rear view from the default camera). @param {Lab} lab */
function facing(lab) {
  if (lab.face === 'north') return Math.PI;
  return lab.face === 'back' ? FACE_CAMERA + Math.PI : FACE_CAMERA;
}

/** @param {Lab} lab @param {string} id */
function wander(lab, id) {
  const key = pick(BUILDING_KEYS);
  const roll = Math.random();
  const pace = roll < 0.7 ? 'walk' : roll < 0.95 ? 'run' : 'teleport';
  lab.world.goTo(id, key, { pace }).then((arrived) => {
    if (!arrived) return;
    lab.world.setActivity(id, BUILDING_ACTIVITY[key]);
    if (Math.random() < 0.4) {
      const tone = pick(TONES);
      lab.world.say(id, pick(LINES[tone]), { tone });
    }
  });
}

/** A busy town: agents wandering between buildings. @param {Lab} lab @param {number} [count] */
export function chaos(lab, count = 20) {
  const templates = Object.keys(TEMPLATES);
  for (let i = 0; i < count; i++) {
    const id = lab.spawn(templates[i % templates.length], {
      color: CREW_COLORS[i % CREW_COLORS.length],
      spawnAt: pick(BUILDING_KEYS),
      entrance: 'pop',
    });
    lab.after(300 + Math.random() * 1500, () => wander(lab, id));
    lab.every(4000 + Math.random() * 5000, () => wander(lab, id));
  }
  if (lab.zoom) lab.after(60, () => lab.world.zoomBy(lab.zoom));
}

/** Twelve agents for eight spots: watch the queue form and move up. @param {Lab} lab */
function queue(lab) {
  const ids = Array.from({ length: 12 }, (_, i) =>
    lab.spawn(Object.keys(TEMPLATES)[i % 6], { color: CREW_COLORS[i % 8], spawnAt: 'academy', entrance: 'none' }),
  );
  ids.forEach((id, i) => lab.after(200 + i * 250, () => lab.world.goTo(id, 'library').then((ok) => ok && lab.world.setActivity(id, 'read'))));
  let next = 0;
  lab.after(9000, () =>
    lab.every(3000, () => {
      if (next < 6) lab.world.goTo(ids[next++], 'academy');
    }),
  );
  lab.after(60, () => {
    lab.world.focusBuilding('library');
    lab.world.zoomBy(lab.zoom ?? 2);
  });
}

/** Personal weather and paper planes. @param {Lab} lab */
function weather(lab) {
  const ids = Array.from({ length: 6 }, (_, i) => {
    const id = lab.spawn(Object.keys(TEMPLATES)[i], { color: CREW_COLORS[i], entrance: 'none' });
    lab.place(id, (i - 2.5) * 1.6, STAGE_Z + (i % 2) * 0.6, FACE_CAMERA);
    return id;
  });
  lab.world.weather(ids[0], 'rain');
  lab.world.weather(ids[2], 'storm');
  lab.world.setActivity(ids[0], 'facepalm');
  lab.world.setActivity(ids[2], 'wait');
  lab.every(1600, () => lab.world.sendMessage(pick(ids), { agent: pick(ids) }));
  lab.every(2900, () => lab.world.sendMessage(pick(ids), { building: 'post' }));
  closeUp(lab, ids, 2, 2.4);
}

/** Arrivals and departures by portal, bus and pop. @param {Lab} lab */
function entrances(lab) {
  const kinds = [
    ['portal', 'portal'],
    ['bus', 'bus'],
    ['pop', 'poof'],
  ];
  let n = 0;
  lab.every(1500, () => {
    const [entrance, exit] = kinds[n % 3];
    const id = lab.spawn(Object.keys(TEMPLATES)[n % 6], { entrance, color: CREW_COLORS[n % 8] });
    n++;
    lab.after(5000, () => lab.world.removeAgent(id, { exit }));
  });
  lab.after(60, () => {
    lab.world.focusBuilding('hall');
    lab.world.zoomBy(lab.zoom ?? 1.6);
  });
}

/** @type {Record<string, (lab: Lab) => void>} */
export const SCENARIOS = { lineup, activities, bubbles, effects, crowd: (lab) => chaos(lab), queue, weather, entrances };
