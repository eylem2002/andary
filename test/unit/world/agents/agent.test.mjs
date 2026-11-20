import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../../../../public/js/world/agents/agent.js';
import { enter, leave } from '../../../../public/js/world/agents/arrivals.js';
import { RUN_SPEED, WALK_SPEED } from '../../../../public/js/world/agents/animator.js';
import { resolveLook } from '../../../../public/js/world/agents/looks.js';
import { planRoute, standingSpots } from '../../../../public/js/world/agents/routes.js';

/** Stands in for the DOM tag: the Agent only calls a few methods on it. */
const fakeTag = () => /** @type {any} */ ({ remove() {}, setSelected() {}, setHovered() {} });
const makeAgent = (id = 's:a', spec = {}) => new Agent(id, 'Test', resolveLook({ id, ...spec }), fakeTag());
const run = (agent, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) agent.update(dt);
};

test('an agent walks its route at walking pace, faces its way, and arrives facing the building', () => {
  const agent = makeAgent();
  agent.position.set(0, 0, 0);
  agent.walk(
    [
      { x: 4, z: 0 },
      { x: 4, z: -2 },
    ],
    'walk',
    Math.PI,
  );
  let arrived = null;
  agent.waiters.push((ok) => (arrived = ok));
  run(agent, 1);
  assert.ok(agent.position.x > 1 && agent.position.x < WALK_SPEED, `eases into its stride: ${agent.position.x}`);
  assert.ok(Math.abs(agent.heading - Math.PI / 2) < 0.05, 'faces east while walking east');
  assert.equal(agent.anim.activity, 'walk');
  run(agent, 3);
  assert.equal(arrived, true);
  assert.ok(Math.hypot(agent.position.x - 4, agent.position.z + 2) < 1e-6, 'stops exactly on the spot');
  assert.ok(Math.abs(Math.cos(agent.heading) + 1) < 1e-3, 'turns to face north, toward the door');
  assert.equal(agent.anim.activity, 'idle', 'settles into its activity');
});

test('running is about twice as fast as walking', () => {
  const walker = makeAgent('s:w');
  const runner = makeAgent('s:r');
  for (const a of [walker, runner]) a.position.set(0, 0, 0);
  walker.walk([{ x: 50, z: 0 }], 'walk', 0);
  runner.walk([{ x: 50, z: 0 }], 'run', 0);
  run(walker, 2);
  run(runner, 2);
  const ratio = runner.position.x / walker.position.x;
  assert.ok(Math.abs(ratio - RUN_SPEED / WALK_SPEED) < 0.25, `ratio ${ratio}`);
  assert.equal(runner.anim.activity, 'run');
});

test('carrying stays in hand while walking', () => {
  const agent = makeAgent();
  agent.activity = 'carry';
  agent.walk([{ x: 3, z: 0 }], 'walk', 0);
  assert.equal(agent.anim.overlay, 'carry');
  run(agent, 3);
  assert.equal(agent.anim.activity, 'carry');
  assert.equal(agent.anim.overlay, null);
});

test('queued agents wait in line instead of working', () => {
  const agent = makeAgent();
  agent.activity = 'read';
  agent.queued = true;
  agent.settle();
  assert.equal(agent.anim.activity, 'wait');
  agent.activity = 'celebrate';
  agent.settle();
  assert.equal(agent.anim.activity, 'celebrate', 'reactions still play in a queue');
});

test('the head-top anchor follows the pose (lower when sitting)', () => {
  const agent = makeAgent();
  run(agent, 0.5);
  const standing = agent.top.y;
  assert.ok(standing > 1.1 && standing < 2, `standing top ${standing}`);
  agent.anim.set('sleep');
  run(agent, 1);
  assert.ok(agent.top.y < standing - 0.2, 'drops when it sits down to sleep');
});

/** A minimal host for the entrance/exit sequences. */
function host() {
  const calls = [];
  return {
    calls,
    effects: { emit: (kind) => calls.push(`fx:${kind}`) },
    anchorPoint: (key, name) => (name === 'bus' ? { x: 3, y: 0, z: 21 } : { x: -5, y: 0, z: -2 }),
    standingFor: () => standingSpots('hall')[0],
    bus: (action) => calls.push(`bus:${action}`),
    busWait: () => 0.5,
    moveTo: (agent, key) => calls.push(`moveTo:${key}`),
    walkToSlot: (agent) => {
      const stand = standingSpots('hall')[0];
      agent.walk(planRoute(agent.position, stand, agent.lane), 'walk', stand.facing);
    },
  };
}

test('a pop entrance appears at the spot with a poof and settles', () => {
  const h = host();
  const agent = makeAgent();
  enter(/** @type {any} */ (h), agent, 'pop');
  assert.equal(agent.entering, true);
  assert.ok(agent.appear < 0.05);
  run(agent, 0.6);
  assert.equal(agent.entering, false);
  assert.ok(Math.abs(agent.appear - 1) < 1e-6);
  assert.deepEqual(h.calls, ['fx:poof']);
});

test('a portal entrance beams in at the portal, then walks to its spot', () => {
  const h = host();
  const agent = makeAgent();
  enter(/** @type {any} */ (h), agent, 'portal');
  assert.deepEqual([agent.position.x, agent.position.z], [-5, -2]);
  run(agent, 1.1);
  assert.equal(agent.entering, false);
  assert.ok(agent.moving, 'walking from the portal to its spot');
  assert.ok(h.calls.includes('fx:portal'));
});

test('a goTo received while entering wins over the walk to the spawn spot', () => {
  const h = host();
  const agent = makeAgent();
  enter(/** @type {any} */ (h), agent, 'bus');
  agent.pendingGo = { key: 'library', pace: 'run' };
  run(agent, 0.5);
  assert.ok(agent.appear < 0.01, 'stays hidden until the bus has pulled in');
  run(agent, 1.5);
  assert.ok(h.calls.includes('bus:trip'));
  assert.ok(h.calls.includes('moveTo:library'));
});

test('exits play, then call done exactly once', () => {
  for (const exit of ['poof', 'portal', 'bus']) {
    const h = host();
    const agent = makeAgent(`s:${exit}`);
    agent.position.set(standingSpots('station')[0].x, 0, standingSpots('station')[0].z);
    let done = 0;
    leave(/** @type {any} */ (h), agent, exit, () => done++);
    run(agent, 12);
    assert.equal(done, 1, `${exit} finished`);
    if (exit === 'bus') assert.ok(h.calls.includes('bus:depart'));
  }
});

test('routes from planRoute are followed to the end', () => {
  const agent = makeAgent();
  const from = standingSpots('library')[0];
  const to = standingSpots('grove')[2];
  agent.position.set(from.x, 0, from.z);
  agent.walk(planRoute(agent.position, to, agent.lane), 'run', to.facing);
  run(agent, 30);
  assert.equal(agent.moving, false);
  assert.ok(Math.hypot(agent.position.x - to.x, agent.position.z - to.z) < 1e-6);
});
