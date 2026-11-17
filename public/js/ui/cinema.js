// The director camera: watches the event stream and keeps the camera close on the most
// interesting agent, like a sports broadcast, with a caption saying who is on screen and what
// they are doing. It steps aside while the viewer handles the camera or has something selected,
// and takes over again after a quiet spell. The caption repeats what the HUD panels already say,
// so it is hidden from assistive technology.
import { BUILDINGS } from '../core/catalog.js';
import { h, setCrewColor, setHidden, setText } from './dom.js';
import { doingText, roleLabel } from './format.js';
import { BUILDING_ICONS, icon } from './icons.js';
import { TIMING, nextShot, remember } from './shots.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./shots.js').Shot} Shot */

const TICK_MS = 500;
/**
 * Zoom 1 fits the town to a desktop screen's height but shows only the middle of it on a phone held
 * upright, where people come out about a third of their desktop size: shots there zoom further.
 */
const PHONE_ZOOM = 1.5;
/** Events older than this when they arrive (history replayed to a new tab) are not news. */
const STALE_MS = 30_000;
/** Keys the 3D view uses to move its own camera. */
const CAMERA_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '_', 'q', 'Q', 'e', 'E']);

/**
 * @param {HudContext} ctx
 * @param {{ now?: () => number, every?: (fn: () => void, ms: number) => () => void }} [options]
 */
export function createCinema(ctx, { now = Date.now, every = repeat } = {}) {
  /** @type {Map<string, import('./shots.js').Moment>} */
  const moments = new Map();
  /** @type {Shot|null} */
  let shot = null;
  let pausedUntil = 0;
  const caption = buildCaption();
  /** @type {() => void} */
  let stopTicking = () => {};
  /** @type {() => void} */
  let stopListening = () => {};

  const unsubscribe = ctx.store.subscribe((change) => {
    if (change.type === 'reset') {
      moments.clear();
      shot = null;
    } else if (change.type === 'event' && !isStale(change.event, now())) {
      remember(moments, change.event, now());
    }
  });

  /** The director may move the camera only when the viewer is not using it. */
  function free() {
    return ctx.prefs.directorCam && !ctx.view.selection && !ctx.view.follow && now() >= pausedUntil && Boolean(ctx.world());
  }

  function tick() {
    if (!free()) {
      shot = null;
      renderCaption();
      return;
    }
    const exists = (/** @type {string} */ key) => Boolean(ctx.store.getState().agents[key]);
    const next = nextShot({ moments, current: shot, now: now(), exists });
    if (next) {
      shot = next;
      moments.delete(next.agentKey);
      ctx.world()?.focusAgent(next.agentKey, { follow: true, zoom: next.zoom * (ctx.view.mobile ? PHONE_ZOOM : 1) });
    }
    renderCaption();
  }

  function renderCaption() {
    const agent = shot ? ctx.store.getState().agents[shot.agentKey] : null;
    setHidden(caption.el, !agent);
    if (!agent || !shot) return;
    if (caption.subject !== shot.agentKey) {
      caption.subject = shot.agentKey;
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
     * Starts watching once the world exists; `container` is the 3D view, whose pointer, wheel and
     * camera keys mean the viewer has taken the camera.
     * @param {HTMLElement} container
     */
    start(container) {
      stopTicking();
      stopListening();
      stopTicking = every(tick, TICK_MS);
      stopListening = listenForViewer(container, () => this.viewerTookCamera());
      tick();
    },
    /** The viewer moved the camera: stand back until things have been quiet for a while. */
    viewerTookCamera() {
      pausedUntil = now() + TIMING.idleResumeMs;
      shot = null;
      renderCaption();
    },
    /** @param {boolean} on */
    setEnabled(on) {
      pausedUntil = 0;
      shot = null;
      if (!on) ctx.world()?.stopFollow();
      tick();
    },
    dispose() {
      unsubscribe();
      stopTicking();
      stopListening();
    },
  };
}

/** @param {{ ts?: number, rx?: number }} event @param {number} now */
function isStale(event, now) {
  const at = Number(event.rx ?? event.ts);
  return Number.isFinite(at) && now - at > STALE_MS;
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
  const onKey = (/** @type {KeyboardEvent} */ event) => {
    if (CAMERA_KEYS.has(event.key)) onViewer();
  };
  container.addEventListener('pointerdown', onViewer);
  container.addEventListener('wheel', onViewer, { passive: true });
  container.addEventListener('keydown', onKey);
  return () => {
    container.removeEventListener('pointerdown', onViewer);
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
  const el = h('div', { class: 'hud hud-cinema', 'aria-hidden': 'true', 'data-testid': 'director-caption', hidden: true },
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
