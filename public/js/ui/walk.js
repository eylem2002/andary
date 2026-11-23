// Walking your character in a team town (CONTRACTS §4.11). Walk mode (the toolbar's Walk button,
// or G) lets a click or tap on the ground walk there, and arrows or WASD on the town take one step
// a press (four a second while held); the camera follows the character. The Walk panel has the
// "Walk to…" list (every door, home and teammate, for keyboards and screen readers), a line that
// says where you are, a step pad on phones, the set emotes and phrases, and "come look". This
// only asks: the host (or the demo) moves the figure, and every screen shows the same walk.
import { h, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { BUILDINGS } from '../core/catalog.js';
import { EMOTES, PHRASES, headingTile, stepFrom, walkDuration } from '../core/presence.js';
import { HOMES, LOTS } from '../core/town-map.js';
import { displayName, nameWithRoster, personFigureId } from './town-people.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./town-people.js').PersonView} PersonView */
/** @typedef {[number, number]} Tile */
/** @typedef {{ value: string, label: string, group: 'Buildings'|'Homes'|'Teammates', tile: Tile }} Place */

/** How close the camera comes while it follows your character (1 is the whole town). */
const WALK_ZOOM = 2.2;

/** One step a press; a held key repeats four times a second. */
export const STEP_EVERY_MS = 250;

/** What each emote is called (its button's name, and what screen readers hear). */
export const EMOTE_NAMES = Object.freeze(['Wave', 'Thumbs up', 'Party', 'Coffee', 'Thinking', 'Heart', 'Laugh', 'Look']);

/** The phone pad: a screen direction for each button (app.css turns the arrow). */
const PAD = Object.freeze([
  { name: 'Step up', key: 'ArrowUp', right: 0, up: 1 },
  { name: 'Step left', key: 'ArrowLeft', right: -1, up: 0 },
  { name: 'Step right', key: 'ArrowRight', right: 1, up: 0 },
  { name: 'Step down', key: 'ArrowDown', right: 0, up: -1 },
]);

/** Where a person is, as core/presence.js reads it. @param {PersonView} person */
function whereOf(person) {
  return { tile: person.tile ?? /** @type {Tile} */ ([...(HOMES[person.slot] ?? HOMES[0]).door]), walk: person.walk ?? null };
}

/**
 * Where a tile is, in words, for the live region: a building's door, someone's home, or a street.
 * @param {Tile} tile
 * @param {(slot: number) => string|null} homeName  whose home a plot is ("your", "Lina's"), null when empty
 */
export function placeOf(tile, homeName) {
  const same = (/** @type {readonly number[]} */ t) => t[0] === tile[0] && t[1] === tile[1];
  const lot = Object.values(LOTS).find((l) => same(l.door));
  if (lot) return `the ${BUILDINGS[/** @type {keyof typeof BUILDINGS} */ (lot.key)].name} door`;
  const slot = HOMES.findIndex((home) => same(home.door));
  const owner = slot >= 0 ? homeName(slot) : null;
  return owner ? `${owner} home` : 'the street';
}

/**
 * Whose home a plot is, in words ("your", "Lina's"), or null for an empty plot.
 * @param {PersonView[]} people @param {string|null} me
 * @returns {(slot: number) => string|null}
 */
export function homeOwner(people, me) {
  return (slot) => {
    const person = people.find((p) => p.slot === slot);
    if (!person) return null;
    return person.name === me ? 'your' : `${displayName(person)}'s`;
  };
}

/**
 * What the "Walk to…" list offers: every building's door, every home, and the teammates who are
 * out (where they are going).
 * @param {PersonView[]} people @param {string|null} me @param {number} now  on the server's clock
 * @returns {Place[]}
 */
export function walkPlaces(people, me, now) {
  /** @type {Place[]} */
  const places = Object.values(LOTS)
    .map((lot) => ({ value: `building:${lot.key}`, label: BUILDINGS[/** @type {keyof typeof BUILDINGS} */ (lot.key)].name, group: /** @type {const} */ ('Buildings'), tile: /** @type {Tile} */ ([...lot.door]) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const owner = homeOwner(people, me);
  for (const person of [...people].sort((a, b) => a.slot - b.slot)) {
    const whose = owner(person.slot) ?? '';
    places.push({ value: `home:${person.slot}`, label: `${whose[0].toUpperCase()}${whose.slice(1)} home`, group: 'Homes', tile: /** @type {Tile} */ ([...(HOMES[person.slot] ?? HOMES[0]).door]) });
  }
  for (const person of people) {
    if (person.name === me || !person.online) continue;
    places.push({ value: `person:${person.name}`, label: nameWithRoster(person), group: 'Teammates', tile: headingTile(whereOf(person), now) });
  }
  return places;
}

/**
 * @param {HudContext} ctx
 */
export function createWalk(ctx) {
  let on = false;
  /** The last step by key: a held key repeats at most every STEP_EVERY_MS; another key goes at once. */
  let lastStep = { at: -Infinity, dir: '' };
  /** @type {Place[]} */
  let places = [];
  const serverNow = () => Date.now() + ctx.view.clockOffset;
  const me = () => ctx.view.people.find((p) => p.name === ctx.view.me) ?? null;

  const ui = buildPanel({
    stop: () => setOn(false),
    walkTo: (value) => {
      const place = places.find((p) => p.value === value);
      if (place) walkTo(place.tile);
    },
    pad: (right, up) => {
      const step = ctx.world()?.screenStep?.(right, up);
      if (step) takeStep(step, { throttle: false });
    },
    say: (kind, id) => send(() => ctx.controls.say?.(kind, id)),
    ask: askToLook,
  });
  const tellWhere = whereTeller(ctx, ui.where, serverNow);

  /** Sends one request; says so when it could not be sent. @param {() => boolean|undefined} request */
  function send(request) {
    if (request()) return true;
    setText(ui.where, 'Not connected to the town: try again in a moment.');
    return false;
  }

  /** @param {Tile} tile */
  function walkTo(tile) {
    // Walking is the viewer moving the camera: the director camera stands back for a while.
    ctx.cinema.viewerTookCamera();
    send(() => ctx.controls.walk?.(tile));
  }

  /** @param {[number, number]} step @param {{ throttle?: boolean }} [options] */
  function takeStep([dc, dr], { throttle = true } = {}) {
    const person = me();
    if (!person) return;
    const now = Date.now();
    const dir = `${dc},${dr}`;
    if (throttle && dir === lastStep.dir && now - lastStep.at < STEP_EVERY_MS) return;
    lastStep = { at: now, dir };
    const next = stepFrom(headingTile(whereOf(person), serverNow()), dc, dr);
    if (next) walkTo(next);
    else setText(ui.where, 'You cannot walk that way.');
  }

  function askToLook() {
    const sel = ctx.view.selection;
    const name = ui.lookTo.value;
    if (!sel || !name) return;
    const at = sel.type === 'agent' ? { agent: sel.id } : { building: sel.key };
    const person = ctx.view.people.find((p) => p.name === name);
    if (send(() => ctx.controls.lookAsk?.(name, at))) setText(ui.lookHelp, `Asked ${person ? displayName(person) : name} to come look.`);
  }

  /**
   * Walk mode on or off.
   * @param {boolean} value @param {{ focus?: boolean }} [options]  focus: the town takes the keyboard (G)
   */
  function setOn(value, { focus = false } = {}) {
    const person = me();
    if (value && !person) {
      ctx.announcer.polite('Only the people of a team town have a character to walk.');
      return;
    }
    on = value;
    const world = ctx.world();
    world?.setWalkMode?.(on);
    ctx.view.walking = on;
    if (on && person) {
      world?.focusAgent(personFigureId(person.name), { follow: true, zoom: WALK_ZOOM });
      if (focus) document.getElementById('world')?.focus();
      ctx.announcer.polite('Walk mode on. On the town, the arrow keys or W, A, S and D take a step and Shift with the arrows moves the view; a click on the ground walks there. G stops.');
    } else {
      world?.stopFollow();
      if (ctx.view.follow) ctx.setFollow(false);
      ctx.announcer.polite('Walk mode off.');
    }
    ctx.refresh();
  }

  return {
    el: ui.el,
    setOn,
    /** G and the toolbar's Walk button. @param {{ focus?: boolean }} [options] */
    toggle(options) {
      setOn(!on, options);
    },
    /** The world is here (or a new one): walk mode and its events. @param {import('./types.js').World} world */
    attachWorld(world) {
      world.setWalkMode?.(on);
      world.on('ground', (tile) => {
        if (on) walkTo(/** @type {Tile} */ (tile));
      });
      world.on('step', (step) => {
        if (on) takeStep(/** @type {[number, number]} */ (step));
      });
    },
    /** Someone's emote or phrase, over their character. @param {{ kind: 'emote'|'phrase', name: string, id: number }} said */
    said: (said) => showSaid(ctx, said),
    /** One render: shown only in walk mode; the pad on phones, unless turned off in Settings. */
    render() {
      if (on && !me()) setOn(false);
      setHidden(ui.el, !on);
      if (!on) return;
      setHidden(ui.pad, !(ctx.view.mobile && ctx.prefs.walkPad));
      ui.setMobile(ctx.view.mobile);
      places = renderLists(ctx, ui, serverNow());
      tellWhere();
    },
  };
}

/**
 * The Walk panel's controls, wired to what they ask for.
 * @param {{ stop: () => void, walkTo: (value: string) => void, pad: (right: -1|0|1, up: -1|0|1) => void, say: (kind: 'emote'|'phrase', id: number) => void, ask: () => void }} act
 */
function buildPanel(act) {
  const where = h('p', { class: 'hud-walk__where', role: 'status', 'aria-live': 'polite', 'data-testid': 'walk-where' });
  const stop = h('button', { type: 'button', class: 'hud-iconbtn', 'aria-label': 'Stop walking', 'aria-keyshortcuts': 'G' }, icon('close', { size: 18 }));
  stop.addEventListener('click', act.stop);
  const to = /** @type {HTMLSelectElement} */ (h('select', { id: 'hud-walk-to', class: 'hud-select hud-walk__to', 'data-testid': 'walk-to' }));
  to.addEventListener('change', () => {
    const value = to.value;
    to.value = '';
    act.walkTo(value);
  });
  const pad = h('div', { class: 'hud-walk__pad', role: 'group', 'aria-label': 'Step' },
    ...PAD.map((dir) => {
      const button = h('button', { type: 'button', class: `hud-walk__step hud-walk__step--${dir.key.slice(5).toLowerCase()}`, 'aria-label': dir.name, 'aria-keyshortcuts': dir.key }, icon('arrowUp', { size: 20 }));
      button.addEventListener('click', () => act.pad(/** @type {-1|0|1} */ (dir.right), /** @type {-1|0|1} */ (dir.up)));
      return button;
    }));
  const emotes = h('div', { class: 'hud-walk__emotes', role: 'group', 'aria-label': 'Emotes' },
    ...EMOTES.map((emoji, id) => {
      const button = h('button', { type: 'button', class: 'hud-walk__emote', 'aria-label': EMOTE_NAMES[id], title: EMOTE_NAMES[id] }, h('span', { 'aria-hidden': 'true', text: emoji }));
      button.addEventListener('click', () => act.say('emote', id));
      return button;
    }));
  const phrases = h('div', { class: 'hud-walk__phrases', role: 'group', 'aria-label': 'Say' },
    ...PHRASES.map((phrase, id) => {
      const button = h('button', { type: 'button', class: 'hud-btn hud-btn--small' }, phrase);
      button.addEventListener('click', () => act.say('phrase', id));
      return button;
    }));
  const lookTo = /** @type {HTMLSelectElement} */ (h('select', { id: 'hud-walk-look', class: 'hud-select' }));
  const lookButton = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'aria-describedby': 'hud-walk-look-help' }, 'Ask'));
  const lookHelp = h('p', { class: 'hud-setting__help', id: 'hud-walk-look-help' });
  lookButton.addEventListener('click', act.ask);
  const summary = h('summary', { text: 'Phrases and come look' });
  const more = h('details', { class: 'hud-walk__more' },
    summary,
    phrases,
    h('div', { class: 'hud-walk__look' }, h('label', { for: 'hud-walk-look', text: 'Ask to come look' }), lookTo, lookButton),
    lookHelp);
  const row = h('div', { class: 'hud-walk__row' }, h('label', { for: 'hud-walk-to', class: 'hud-walk__label', text: 'Walk to' }), to, emotes);
  const el = h('section', { class: 'hud hud-walk', 'aria-label': 'Walk', 'data-testid': 'walk-panel', hidden: true },
    h('div', { class: 'hud-walk__head' }, icon('walk', { size: 18 }), where, stop),
    row,
    pad,
    more);
  /** On a phone the emotes fold away with the phrases, so the panel leaves the town in view. @param {boolean} mobile */
  function setMobile(mobile) {
    const home = mobile ? more : row;
    if (emotes.parentElement === home) return;
    if (mobile) summary.after(emotes);
    else row.append(emotes);
    setText(summary, mobile ? 'Emotes, phrases and come look' : 'Phrases and come look');
  }
  return { el, where, to, pad, lookTo, lookButton, lookHelp, setMobile };
}

/**
 * The "Walk to…" and "Ask to come look" lists follow the people; each is rebuilt only when what
 * it offers changed.
 * @param {HudContext} ctx @param {ReturnType<typeof buildPanel>} ui @param {number} now  on the server's clock
 * @returns {Place[]}
 */
function renderLists(ctx, ui, now) {
  const places = walkPlaces(ctx.view.people, ctx.view.me, now);
  const signature = places.map((p) => `${p.value}=${p.label}`).join('|');
  if (ui.to.dataset.signature !== signature) {
    ui.to.dataset.signature = signature;
    /** @type {Record<string, HTMLElement>} */
    const groups = {};
    for (const place of places) (groups[place.group] ??= h('optgroup', { label: place.group })).append(h('option', { value: place.value, text: place.label }));
    ui.to.replaceChildren(h('option', { value: '', text: 'Choose a place…' }), ...Object.values(groups));
  }
  const others = ctx.view.people.filter((p) => p.name !== ctx.view.me && p.online);
  const names = others.map((p) => `${p.name}=${displayName(p)}`).join('|');
  if (ui.lookTo.dataset.signature !== names) {
    ui.lookTo.dataset.signature = names;
    const keep = ui.lookTo.value;
    ui.lookTo.replaceChildren(...others.map((p) => h('option', { value: p.name, text: nameWithRoster(p) })));
    if (others.some((p) => p.name === keep)) ui.lookTo.value = keep;
  }
  const sel = ctx.view.selection;
  ui.lookButton.disabled = !sel || others.length === 0;
  if (!ui.lookHelp.textContent?.startsWith('Asked')) setText(ui.lookHelp, others.length === 0 ? 'Nobody else is in town right now.' : sel ? 'They get a note with a Go button.' : 'Select an agent or a building first.');
  return places;
}

/**
 * Says where your character is going, and where they are once there: each walk once.
 * @param {HudContext} ctx @param {HTMLElement} where @param {() => number} serverNow
 */
function whereTeller(ctx, where, serverNow) {
  let told = '';
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let arrival;
  const placeName = (/** @type {Tile} */ tile) => placeOf(tile, homeOwner(ctx.view.people, ctx.view.me));
  return () => {
    const person = ctx.view.people.find((p) => p.name === ctx.view.me);
    if (!person) return;
    const { tile, walk } = whereOf(person);
    const key = walk ? `${walk.at}:${walk.path.length}` : `${tile}`;
    if (key === told) return;
    told = key;
    clearTimeout(arrival);
    const end = walk ? /** @type {Tile} */ (walk.path.at(-1)) : tile;
    const there = () => setText(where, `You are at ${placeName(end)}.`);
    const left = walk ? walk.at + walkDuration(walk.path) - serverNow() : 0;
    if (left <= 0) return there();
    // A single step is not worth a sentence each; a longer walk says where it goes.
    if (walk && walk.path.length > 2) setText(where, `Walking to ${placeName(end)}…`);
    arrival = setTimeout(there, left);
  };
}

/**
 * Someone's emote or phrase over their character; screen readers hear a teammate's.
 * @param {HudContext} ctx @param {{ kind: 'emote'|'phrase', name: string, id: number }} said
 */
function showSaid(ctx, { kind, name, id }) {
  const text = (kind === 'emote' ? EMOTES : PHRASES)[id];
  const person = ctx.view.people.find((p) => p.name === name);
  if (!text || !person) return;
  const world = ctx.world();
  if (kind === 'emote') world?.emote?.(personFigureId(name), text);
  else world?.say?.(personFigureId(name), text, { tone: 'speech' });
  if (name !== ctx.view.me) ctx.announcer.polite(`${displayName(person)}: ${kind === 'emote' ? EMOTE_NAMES[id] : text}`);
}

/**
 * A teammate asks this person to come look at an agent or a building: a note with Go and Not
 * now; the camera moves only on Go. Off in Settings, nothing is shown.
 * @param {HudContext} ctx
 * @param {{ from: string, at: unknown }} ask
 */
export function showLookAsk(ctx, { from, at }) {
  if (!ctx.prefs.lookAsks) return;
  const person = ctx.view.people.find((p) => p.name === from);
  const target = lookTarget(ctx, at);
  if (!person || !target) return;
  const who = nameWithRoster(person);
  ctx.toasts.show({
    icon: 'users',
    title: `${who} asks you to come look`,
    body: target.label,
    action: { label: 'Go', run: () => ctx.select(target.sel, { camera: true, focus: true }) },
    secondary: { label: 'Not now', run: () => {} },
  });
  ctx.announcer.polite(`${who} asks you to come look at ${target.label}. The note has a Go button.`);
}

/**
 * What a "come look" points at, if this town has it.
 * @param {HudContext} ctx @param {unknown} at
 * @returns {{ sel: import('./types.js').Selection, label: string }|null}
 */
function lookTarget(ctx, at) {
  const value = /** @type {Record<string, unknown>|null} */ (at && typeof at === 'object' ? at : null);
  if (typeof value?.building === 'string' && Object.hasOwn(BUILDINGS, value.building)) {
    return { sel: { type: 'building', key: value.building }, label: `the ${BUILDINGS[/** @type {keyof typeof BUILDINGS} */ (value.building)].name}` };
  }
  const agent = typeof value?.agent === 'string' ? ctx.store.getState().agents[value.agent] : null;
  return agent ? { sel: { type: 'agent', id: agent.key }, label: agent.name } : null;
}
