// The director camera on screen: connects the director's choices (shots.js) to the HUD and the 3D
// view, and draws the caption saying who is in the shot and what they are doing. The caption is
// plain text, not a live region: it changes every few seconds, which would be noise if announced,
// but in the full-screen town it is the only text about the shot, so it stays readable.
import { BUILDINGS } from '../core/catalog.js';
import { motionReduced } from './appearance.js';
import { h, setCrewColor, setHidden, setText } from './dom.js';
import { doingText, roleLabel } from './format.js';
import { BUILDING_ICONS, icon } from './icons.js';
import { createDirectorCam, directorOn } from './shots.js';

/** @typedef {import('./types.js').HudContext} HudContext */

const TICK_MS = 500;
/**
 * Zoom 1 fits the town to a desktop screen's height but shows only the middle of it on a phone held
 * upright, where people come out about a third of their desktop size: shots there zoom further.
 */
const PHONE_ZOOM = 1.5;
/** Keys the 3D view uses to move its own camera (arrows pan, +/- zoom, Q/E rotate, Home resets, Escape lets go). */
const CAMERA_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '_', 'q', 'Q', 'e', 'E', 'Home', 'Escape']);

/**
 * Whether the director camera is on for this viewer right now.
 * @param {HudContext} ctx
 */
export function directorActive(ctx) {
  return directorOn(ctx.prefs.directorCam, motionReduced());
}

/**
 * @param {HudContext} ctx
 * @param {{ now?: () => number, every?: (fn: () => void, ms: number) => () => void }} [options]
 */
export function createCinema(ctx, { now = Date.now, every = repeat } = {}) {
  const caption = buildCaption();
  const director = createDirectorCam({
    now,
    enabled: () => directorActive(ctx),
    viewerBusy: () => Boolean(ctx.view.selection) || ctx.view.follow,
    viewerFollows: () => ctx.view.follow,
    onStage: (key) => Boolean(ctx.store.getState().agents[key]) && Boolean(ctx.world()?.hasAgent(key)),
    film: (key, zoom) => ctx.world()?.focusAgent(key, { follow: true, zoom: zoom * (ctx.view.mobile ? PHONE_ZOOM : 1) }),
    stopFilming: () => ctx.world()?.stopFollow(),
  });
  /** @type {() => void} */
  let stopTicking = () => {};
  /** @type {() => void} */
  let stopListening = () => {};

  const unsubscribe = ctx.store.subscribe((change) => {
    if (change.type === 'reset') director.reset();
    else if (change.type === 'event') director.hear(change.event);
  });

  function tick() {
    director.tick();
    renderCaption();
  }

  function renderCaption() {
    const key = director.subject;
    const agent = key ? ctx.store.getState().agents[key] : null;
    setHidden(caption.el, !agent);
    if (!agent || !key) return;
    if (caption.subject !== key) {
      caption.subject = key;
      caption.el.dataset.cut = caption.el.dataset.cut === 'a' ? 'b' : 'a';
    }
    setCrewColor(caption.el, agent.color);
    setText(caption.name, agent.name);
    setText(caption.role, roleLabel(agent));
    renderPlace(caption, agent.building && Object.hasOwn(BUILDINGS, agent.building) ? agent.building : null);
    setText(caption.doing, doingText(agent));
  }

  return {
    el: caption.el,
    /**
     * Starts directing once the 3D view exists. `container` is that view: pointer, wheel and
     * camera keys there mean the viewer has taken the camera.
     * @param {HTMLElement} container
     */
    start(container) {
      stopTicking();
      stopListening();
      director.start();
      stopTicking = every(tick, TICK_MS);
      stopListening = listenForViewer(container, () => this.viewerTookCamera());
      tick();
    },
    /** The viewer moved the camera (here or with the toolbar): stand back for a quiet spell. */
    viewerTookCamera() {
      director.holdOff();
      renderCaption();
    },
    /** Called after the preference changed. @param {boolean} on */
    setEnabled(on) {
      if (on) director.resume();
      tick();
    },
    dispose() {
      director.stop();
      unsubscribe();
      stopTicking();
      stopListening();
    },
  };
}

/** @param {() => void} fn @param {number} ms */
function repeat(fn, ms) {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}

/**
 * @param {HTMLElement} container
 * @param {() => void} onViewer
 */
function listenForViewer(container, onViewer) {
  const onPointer = (/** @type {PointerEvent} */ event) => {
    // The 3D view moves its camera with the main mouse button only; touch and pen always count.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    onViewer();
  };
  const onKey = (/** @type {KeyboardEvent} */ event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (CAMERA_KEYS.has(event.key)) onViewer();
  };
  container.addEventListener('pointerdown', onPointer);
  container.addEventListener('wheel', onViewer, { passive: true });
  container.addEventListener('keydown', onKey);
  return () => {
    container.removeEventListener('pointerdown', onPointer);
    container.removeEventListener('wheel', onViewer);
    container.removeEventListener('keydown', onKey);
  };
}

function buildCaption() {
  const name = h('span', { class: 'hud-cinema__name' });
  const role = h('span', { class: 'hud-cinema__role' });
  const placeIcon = h('span', { class: 'hud-cinema__place-icon' });
  const placeName = h('span', {});
  const place = h('span', { class: 'hud-cinema__place' }, placeIcon, placeName);
  const doing = h('span', { class: 'hud-cinema__doing' });
  const tag = h('span', { class: 'hud-cinema__tag' }, icon('video', { size: 14 }), 'Director cam');
  const el = h('div', { class: 'hud hud-cinema', 'data-testid': 'director-caption', hidden: true },
    h('span', { class: 'hud-cinema__bar' }),
    h('span', { class: 'hud-cinema__text' },
      h('span', { class: 'hud-cinema__head' }, name, tag),
      h('span', { class: 'hud-cinema__meta' }, role, place),
      doing));
  return { el, name, role, place, placeIcon, placeName, doing, subject: '' };
}

/**
 * The building the agent is at or heading to, with its sign's icon.
 * @param {ReturnType<typeof buildCaption>} caption
 * @param {string|null} key
 */
function renderPlace(caption, key) {
  setHidden(caption.place, !key);
  if (!key || caption.place.dataset.building === key) return;
  caption.place.dataset.building = key;
  caption.placeIcon.replaceChildren(icon(BUILDING_ICONS[key] ?? 'info', { size: 14 }));
  setText(caption.placeName, BUILDINGS[key].name);
}
