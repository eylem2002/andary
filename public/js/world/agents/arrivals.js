// How agents arrive and leave: through the Town Hall portal (swirl + light beam), by bus at the
// Bus Stop, or with a cartoon pop/poof. Sequences are chains of Agent transitions and walks.

import { planRoute, routeLength } from './routes.js';

/** Exits by bus from further away than this teleport to the stop instead of a long run. */
const MAX_BUS_RUN = 26;

/**
 * @typedef {object} ArrivalHost  what the sequences need from the crowd
 * @property {{emit: (kind: string, p: {x: number, y: number, z: number}, o?: object) => void}} effects
 * @property {(key: import('../../core/catalog.js').BuildingKey, name?: string) => {x: number, y: number, z: number}} anchorPoint
 * @property {(agent: import('./agent.js').Agent) => {x: number, z: number, facing: number}} standingFor
 * @property {(action: 'trip'|'arrive'|'depart') => void} bus  calls the bus
 * @property {() => number} busWait  seconds until the called bus stands at the stop
 * @property {(agent: import('./agent.js').Agent, key: import('../../core/catalog.js').BuildingKey, pace: string) => void} moveTo
 * @property {(agent: import('./agent.js').Agent, pace: string) => void} walkToSlot
 */

/** @param {import('./agent.js').Agent} agent @param {{x: number, z: number}} p */
function place(agent, p) {
  agent.position.set(p.x, 0, p.z);
}

/** @param {import('./agent.js').Agent} agent */
function bodyPoint(agent, dy = 0.45) {
  return { x: agent.position.x, y: dy * agent.look.height, z: agent.position.z };
}

/**
 * Ends an entrance: go where the director asked meanwhile, else walk to the claimed spot.
 * @param {ArrivalHost} host @param {import('./agent.js').Agent} agent @param {boolean} walk
 */
function finishEntrance(host, agent, walk) {
  agent.entering = false;
  const pending = agent.pendingGo;
  agent.pendingGo = null;
  if (pending) {
    host.moveTo(agent, pending.key, pending.pace);
    return;
  }
  if (walk) host.walkToSlot(agent, 'walk');
  else agent.settle();
}

/**
 * Plays an entrance. The agent has already claimed a spot at its spawn building.
 * @param {ArrivalHost} host
 * @param {import('./agent.js').Agent} agent
 * @param {string} entrance 'portal' | 'bus' | 'pop' | 'none'
 */
export function enter(host, agent, entrance) {
  const stand = host.standingFor(agent);
  agent.heading = agent.goalHeading = stand.facing;
  if (entrance === 'none') {
    place(agent, stand);
    agent.settle();
    return;
  }
  agent.entering = true;
  if (entrance === 'portal') {
    const p = host.anchorPoint('hall', 'portal');
    place(agent, p);
    agent.heading = agent.goalHeading = Math.PI / 4;
    host.effects.emit('portal', { x: p.x, y: 0.5, z: p.z }, { ground: 0 });
    agent.play('portal-in', () => finishEntrance(host, agent, true));
    return;
  }
  if (entrance === 'bus') {
    const p = host.anchorPoint('station', 'bus');
    place(agent, p);
    host.bus('trip'); // pulls in, lets people off, drives on
    agent.play(
      'hidden',
      () => {
        host.effects.emit('poof', bodyPoint(agent), { scale: 0.5 });
        agent.play('pop-in', () => finishEntrance(host, agent, true));
      },
      host.busWait() + 0.3,
    );
    return;
  }
  place(agent, stand);
  host.effects.emit('poof', bodyPoint(agent), { scale: 0.8 });
  agent.play('pop-in', () => finishEntrance(host, agent, false));
}

/**
 * Plays an exit, then calls `done` (which disposes the agent).
 * @param {ArrivalHost} host
 * @param {import('./agent.js').Agent} agent
 * @param {string} exit 'portal' | 'bus' | 'poof'
 * @param {() => void} done
 */
export function leave(host, agent, exit, done) {
  agent.route = null;
  agent.transition = null;
  agent.anim.setOverlay(null);
  agent.appear = Math.max(agent.appear, 0.01);
  if (exit === 'portal') {
    host.effects.emit('portal', bodyPoint(agent, 1.2), { ground: 0 });
    agent.anim.set('wave');
    agent.play('portal-out', done);
    return;
  }
  if (exit === 'bus') {
    leaveByBus(host, agent, done);
    return;
  }
  host.effects.emit('poof', bodyPoint(agent), { scale: 1 });
  agent.play('pop-out', done);
}

/** @param {ArrivalHost} host @param {import('./agent.js').Agent} agent @param {() => void} done */
function leaveByBus(host, agent, done) {
  const stop = host.anchorPoint('station', 'bus');
  host.bus('arrive');
  const climbIn = () => {
    host.bus('depart');
    host.effects.emit('poof', bodyPoint(agent), { scale: 0.5 });
    agent.play('pop-out', done);
  };
  // At the stop: tap a foot until the bus has pulled in, then climb aboard.
  const board = () => {
    const wait = host.busWait();
    if (wait <= 0) {
      climbIn();
      return;
    }
    agent.anim.set('wait');
    agent.play('pause', climbIn, wait);
  };
  const route = planRoute(agent.position, stop, agent.lane);
  if (routeLength(agent.position, route) <= MAX_BUS_RUN) {
    agent.walk(route, 'run', Math.PI, board);
    return;
  }
  // Too far to run: blink over to the stop first.
  agent.play('tele-out', () => {
    place(agent, stop);
    agent.play('tele-in', board);
  });
}
