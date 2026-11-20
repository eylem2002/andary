// The director camera's taste and memory: which moments deserve a close-up, when to cut to them,
// and when to stand back for the viewer. No DOM and no 3D here (cinema.js connects it to the HUD
// and draws the caption), so every choice is unit-tested.
import { isHistoric } from '../core/director.js';

/**
 * How worth watching each kind of town event is, 0–10. Kinds not listed never draw the camera.
 * Arrivals, trouble and celebrations beat routine tool calls.
 */
export const INTEREST = Object.freeze({
  'subagent.start': 9, // a helper steps out of the Town Hall portal
  'session.start': 8, // the bus brings a new crew
  'permission.request': 8, // someone queues at the Permit Office
  'turn.fail': 8, // a thunderstorm over the agent
  'tool.fail': 7,
  'subagent.stop': 6,
  'message.send': 6, // a paper plane between teammates
  'task.completed': 6,
  'compact.start': 6, // off to the spa
  'model.switch': 5,
  'turn.stop': 5,
  prompt: 5,
  'tool.start': 3,
  'todos.set': 3,
  'task.upsert': 2,
});

export const TIMING = Object.freeze({
  /** A shot lasts at least this long, so the viewer can see what is happening. */
  minShotMs: 5500,
  /** After this long the camera moves on to anything else of interest. */
  maxShotMs: 11000,
  /** A moment's pull fades to nothing over this long. */
  memoryMs: 9000,
  /** Quiet time after the viewer handles the camera before the director takes over again. */
  idleResumeMs: 20000,
});

/** Close-ups show a worker and its building; every few shots a wider one shows the neighbourhood. */
export const ZOOM = Object.freeze({ close: 5.5, wide: 2.4 });
const WIDE_EVERY = 4;
/** A remembered moment this strong cuts in as soon as the current shot has had its minimum time. */
const STRONG = 6;

/**
 * @typedef {object} Moment
 * @property {string} agentKey
 * @property {number} score   interest when it happened
 * @property {number} at      when it happened (ms)
 */

/**
 * @typedef {object} Shot
 * @property {string} agentKey
 * @property {number} zoom
 * @property {number} startedAt
 * @property {number} count     shots taken so far, this one included
 */

/** @param {string} kind */
export function interestOf(kind) {
  return Object.hasOwn(INTEREST, kind) ? INTEREST[kind] : 0;
}

/**
 * A moment's pull now: full when fresh, fading linearly to zero over `memoryMs`.
 * @param {Moment} moment @param {number} now
 */
export function weight(moment, now) {
  const age = Math.max(0, now - moment.at);
  return age >= TIMING.memoryMs ? 0 : moment.score * (1 - age / TIMING.memoryMs);
}

/**
 * Keeps each agent's strongest recent moment.
 * @param {Map<string, Moment>} moments
 * @param {{ kind: string, agentKey?: string }} event
 * @param {number} now
 */
export function remember(moments, event, now) {
  const score = interestOf(event.kind);
  if (!score || !event.agentKey) return;
  const previous = moments.get(event.agentKey);
  if (!previous || weight(previous, now) <= score) moments.set(event.agentKey, { agentKey: event.agentKey, score, at: now });
}

/**
 * The moment with the most pull now, for an agent other than the one on screen.
 * @param {Map<string, Moment>} moments @param {string|null} onScreen @param {number} now
 * @param {(agentKey: string) => boolean} exists
 * @param {number} minScore  moments that were less interesting than this do not count
 */
function strongestElsewhere(moments, onScreen, now, exists, minScore) {
  let best = null;
  let bestWeight = 0;
  for (const moment of moments.values()) {
    if (moment.agentKey === onScreen || moment.score < minScore || !exists(moment.agentKey)) continue;
    const pull = weight(moment, now);
    if (pull > bestWeight) {
      best = moment;
      bestWeight = pull;
    }
  }
  return best;
}

/**
 * Decides whether to cut, and to whom. Returns the new shot, or null to keep the current one.
 * Never cuts before a shot's minimum length unless its subject has left; between the minimum and
 * the maximum, cuts only to a strong moment still remembered (one that happened while the shot
 * was held counts); after the maximum, moves on to anything of interest.
 * @param {{ moments: Map<string, Moment>, current: Shot|null, now: number, exists: (agentKey: string) => boolean }} input
 * @returns {Shot|null}
 */
export function nextShot({ moments, current, now, exists }) {
  const subjectGone = Boolean(current) && !exists(current.agentKey);
  const onScreen = current && !subjectGone ? current.agentKey : null;
  let minScore = 0;
  if (current && onScreen) {
    const held = now - current.startedAt;
    if (held < TIMING.minShotMs) return null;
    if (held < TIMING.maxShotMs) minScore = STRONG;
  }
  const moment = strongestElsewhere(moments, onScreen, now, exists, minScore);
  if (!moment) return null;
  const count = (current?.count ?? 0) + 1;
  return { agentKey: moment.agentKey, zoom: count % WIDE_EVERY === 0 ? ZOOM.wide : ZOOM.close, startedAt: now, count };
}

/**
 * Drops moments that have faded completely, so memory stays the size of what is recent.
 * @param {Map<string, Moment>} moments @param {number} now
 */
export function forget(moments, now) {
  for (const [key, moment] of moments) if (now - moment.at >= TIMING.memoryMs) moments.delete(key);
}

/**
 * Whether the director camera runs. "auto" (the default) runs it unless motion is reduced, since
 * it moves the view on its own; an explicit choice wins either way.
 * @param {'auto'|'on'|'off'} choice @param {boolean} motionReduced
 */
export function directorOn(choice, motionReduced) {
  if (choice === 'on') return true;
  if (choice === 'off') return false;
  return !motionReduced;
}

/**
 * Events that were already old when they arrived (history replayed to a new tab) are not news.
 * @param {{ ts?: number, rx?: number }} event @param {number} now
 */
export function isNews(event, now) {
  return !isHistoric(event, now);
}

/**
 * @typedef {object} DirectorCamHost  what the director camera needs from the HUD and the 3D view
 * @property {() => number} now
 * @property {() => boolean} enabled        the viewer wants it (preference and reduced motion)
 * @property {() => boolean} viewerBusy     an agent or building is selected, or the viewer follows one
 * @property {() => boolean} viewerFollows  the viewer's own follow is on: never stop it
 * @property {(agentKey: string) => boolean} onStage  the agent is in the 3D town right now
 * @property {(agentKey: string, zoom: number) => void} film   follow the agent at this zoom
 * @property {() => void} stopFilming       stop following (the camera stays where it is)
 */

/**
 * The director camera's state: what it remembers, which shot is on, and when it stands back. It
 * only ever stops a follow it started itself, and after the viewer has used the camera it waits
 * for a quiet spell before taking over again.
 * @param {DirectorCamHost} host
 */
export function createDirectorCam(host) {
  /** @type {Map<string, Moment>} */
  const moments = new Map();
  /** @type {Shot|null} */
  let shot = null;
  let pausedUntil = 0;
  let running = false;

  /** Leaves the camera to the viewer, letting go of the director's own follow. */
  function standDown() {
    if (shot && !host.viewerFollows()) host.stopFilming();
    shot = null;
  }

  return {
    /** The agent on screen, while the director has the camera. */
    get subject() {
      return shot && host.onStage(shot.agentKey) ? shot.agentKey : null;
    },
    /** Called once the 3D view exists; without it there is no camera to direct. */
    start() {
      running = true;
    },
    stop() {
      standDown();
      running = false;
    },
    /** @param {{ kind: string, agentKey?: string, ts?: number, rx?: number }} event */
    hear(event) {
      const now = host.now();
      if (isNews(event, now)) remember(moments, event, now);
    },
    /** The town started over (demo restart, new connection). */
    reset() {
      moments.clear();
      standDown();
    },
    /** The viewer moved the camera: stand back until things have been quiet for a while. */
    holdOff() {
      pausedUntil = host.now() + TIMING.idleResumeMs;
      standDown();
    },
    /** Turned on by hand: no waiting. */
    resume() {
      pausedUntil = 0;
    },
    /** Decides, every half second or so, whether to keep the shot, cut, or stand back. */
    tick() {
      const now = host.now();
      forget(moments, now);
      if (!running || !host.enabled()) {
        standDown();
        return;
      }
      if (host.viewerBusy()) {
        pausedUntil = now + TIMING.idleResumeMs;
        standDown();
        return;
      }
      if (now < pausedUntil) return;
      const next = nextShot({ moments, current: shot, now, exists: host.onStage });
      if (next) {
        shot = next;
        moments.delete(next.agentKey);
        host.film(next.agentKey, next.zoom);
      }
    },
  };
}
