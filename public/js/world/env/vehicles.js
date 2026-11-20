// Traffic: cars looping the ring road (driving on the right and queueing behind each other and
// the bus), the bus arriving at and leaving the stop through the edge tunnels, the mail truck's
// delivery loop out of the post office garage, and the MCP cargo boat sailing in to the pier.
// Cars and the mail truck wait for people in their lane (agents crossing to a door); the
// environment cannot see the agents, so the facade hands in a query (setPedestrians). The bus
// keeps its timetable: the crowd times arrivals to it, and agents at doors stand clear of it.
import * as THREE from 'three';
import { ringRoadCorners, tileToWorld } from '../layout.js';
import { PIER } from './buildings/industry.js';
import { createPath, laneBlocked, offsetPolyline, roundCorners } from './lane-path.js';
import { SEA } from './terrain.js';
import { createBus, createCar, createCargoBoat, createMailTruck, createMooredBoats } from './vehicle-models.js';
import { C } from './palette.js';

const LANE = 0.5;
const CAR_SPEED = 2.6;
const TUNNEL_X = 25.3;
const BUS_STOP_X = 3.6;
/** A vehicle waits for anyone this close to its lane's centre line (half a car, plus a little). */
const YIELD_REACH = 0.42;

/** @typedef {(x: number, z: number, reach: number) => boolean} Pedestrians  is anyone within reach of this ground point? */

/** @typedef {'arrive'|'depart'|'trip'} VehicleAction */
/** @typedef {{x: number, z: number, angle: number}} Sample */

/**
 * @param {{scene: THREE.Scene, material: THREE.Material, records: Record<string, import('./buildings/index.js').BuildingRecord>, reducedMotion: boolean}} deps
 */
export function createVehicles({ scene, material, records, reducedMotion }) {
  let reduced = reducedMotion;
  const group = new THREE.Group();
  group.name = 'vehicles';
  scene.add(group);
  /** @type {{ occupied: Pedestrians }} */
  const people = { occupied: () => false };
  const bus = createBusRun(group, material);
  const truck = createTruckRun(group, material, records.post, people);
  const cars = createCars(group, material, [bus, truck], people);
  const boats = createBoats(group, material);

  return {
    /** @param {'mailtruck'|'boat'|'bus'} kind @param {VehicleAction} action */
    trigger(kind, action) {
      const act = action === 'arrive' || action === 'depart' ? action : 'trip';
      if (kind === 'bus') bus.request(act);
      else if (kind === 'boat') boats.request(act);
      else if (kind === 'mailtruck') truck.request();
    },
    /** @param {number} dt @param {number} elapsed */
    update(dt, elapsed) {
      const pace = reduced ? 0.6 : 1;
      bus.update(dt);
      cars.update(dt * pace);
      truck.update(dt);
      boats.update(dt, elapsed, reduced);
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reduced = on;
    },
    /** @param {Pedestrians} occupied  asked every frame, for points on the lanes ahead */
    setPedestrians(occupied) {
      people.occupied = occupied;
    },
    dispose() {
      scene.remove(group);
      group.traverse((obj) => /** @type {any} */ (obj).geometry?.dispose());
    },
  };
}

/**
 * Places a mesh on a path sample.
 * @param {THREE.Object3D} mesh @param {Sample} at @param {number} [y]
 */
function put(mesh, at, y = 0) {
  mesh.position.set(at.x, y, at.z);
  mesh.rotation.y = at.angle;
}

/**
 * Cars on both lanes of the ring road. Each keeps its distance to the car ahead in its own lane
 * and stops behind the bus or the mail truck when they are in the way, and for people in its lane.
 * @param {THREE.Group} group
 * @param {THREE.Material} material
 * @param {Array<{position: () => THREE.Vector3 | null}>} others  other vehicles that may block a lane
 * @param {{ occupied: Pedestrians }} people
 */
function createCars(group, material, others, people) {
  const corners = ringRoadCorners();
  const clockwise = createPath(roundCorners(offsetPolyline(corners, LANE, true), 1.4, true, 8), true);
  const anticlockwise = createPath(roundCorners(offsetPolyline([...corners].reverse(), LANE, true), 1.4, true, 8), true);
  const specs = [
    { path: clockwise, color: C.red, start: 0.05 },
    { path: clockwise, color: 0xff4f9a, start: 0.55 },
    { path: anticlockwise, color: 0x19c6c0, start: 0.3 },
  ];
  const cars = specs.map((spec) => {
    const mesh = createCar(spec.color, material);
    mesh.name = 'car';
    group.add(mesh);
    return { mesh, path: spec.path, dist: spec.start * spec.path.length, speed: CAR_SPEED, at: { x: 0, z: 0, angle: 0 }, ahead: { x: 0, z: 0, angle: 0 } };
  });
  return {
    /** @param {number} dt */
    update(dt) {
      for (const car of cars) {
        car.path.sample(car.dist + 1.9, car.ahead);
        let clear = true;
        for (const vehicle of others) {
          const p = vehicle.position();
          // Within 0.75 sideways means the same lane: oncoming traffic is a lane width (1.0) away.
          if (p && Math.hypot(car.ahead.x - p.x, car.ahead.z - p.z) < 1.6 && laneGap(car.ahead, p) < 0.75) clear = false;
        }
        for (const other of cars) {
          if (other !== car && other.path === car.path && Math.hypot(car.ahead.x - other.at.x, car.ahead.z - other.at.z) < 1.1) clear = false;
        }
        if (clear && laneBlocked(car.path, car.dist, people.occupied, YIELD_REACH)) clear = false;
        car.speed += ((clear ? CAR_SPEED : 0) - car.speed) * Math.min(1, dt * (clear ? 1.5 : 6));
        car.dist += car.speed * dt;
        car.path.sample(car.dist, car.at);
        put(car.mesh, car.at);
      }
    },
  };
}

/**
 * Sideways distance from a lane sample to a point, measured across the sample's heading.
 * @param {Sample} at @param {{x: number, z: number}} p
 */
function laneGap(at, p) {
  const dx = p.x - at.x;
  const dz = p.z - at.z;
  // Heading angle a faces (cos a, -sin a); its right-hand normal is (sin a, cos a).
  return Math.abs(dx * Math.sin(at.angle) + dz * Math.cos(at.angle));
}

/**
 * The bus: in from the east tunnel to the stop, out through the west tunnel.
 * @param {THREE.Group} group
 * @param {THREE.Material} material
 */
function createBusRun(group, material) {
  const z = tileToWorld(0, 23).z - LANE;
  const path = createPath([{ x: TUNNEL_X + 2.4, z }, { x: -TUNNEL_X - 2.4, z }], false);
  const stopAt = TUNNEL_X + 2.4 - BUS_STOP_X;
  const mesh = createBus(material);
  mesh.visible = false;
  group.add(mesh);
  const at = { x: 0, z: 0, angle: 0 };
  const position = new THREE.Vector3();
  /** @type {VehicleAction[]} */
  const queue = [];
  const s = { state: 'hidden', t: 0, from: 0, to: 0, duration: 1, dwell: 0 };

  /** @param {VehicleAction} action */
  function start(action) {
    if (action === 'depart' && s.state !== 'stopped') return;
    // Six seconds from the tunnel to the stop: the crowd times bus arrivals with the same figure.
    if (action !== 'depart') Object.assign(s, { state: 'arriving', t: 0, from: 0, to: stopAt, duration: 6 });
    else Object.assign(s, { state: 'departing', t: 0, from: stopAt, to: path.length, duration: 7.5 });
    s.dwell = action === 'trip' ? 3.5 : -1;
  }

  return {
    /** @param {VehicleAction} action */
    request(action) {
      if (s.state === 'hidden' || (s.state === 'stopped' && action === 'depart')) start(action);
      else if (queue.length < 2) queue.push(action);
    },
    /** Where the bus is while it blocks the ring road lane, else null. */
    position() {
      return mesh.visible && Math.abs(position.x) < 22 ? position : null;
    },
    /** @param {number} dt */
    update(dt) {
      if (s.state === 'stopped') {
        if (s.dwell >= 0) {
          s.dwell -= dt;
          if (s.dwell < 0) start('depart');
        } else if (queue.length && queue[0] === 'depart') {
          start(/** @type {VehicleAction} */ (queue.shift()));
        }
        return;
      }
      if (s.state === 'hidden') {
        if (queue.length) start(/** @type {VehicleAction} */ (queue.shift()));
        return;
      }
      s.t = Math.min(1, s.t + dt / s.duration);
      const k = s.state === 'arriving' ? 1 - Math.pow(1 - s.t, 2.2) : Math.pow(s.t, 1.8);
      path.sample(s.from + (s.to - s.from) * k, at);
      put(mesh, at);
      position.set(at.x, 0, at.z);
      mesh.visible = Math.abs(at.x) < TUNNEL_X;
      if (s.t < 1) return;
      s.state = s.state === 'arriving' ? 'stopped' : 'hidden';
      if (s.state === 'hidden') mesh.visible = false;
    },
  };
}

/**
 * The mail truck's delivery loop: out of the post office garage (its roll-up door opens), round
 * the town in left turns, and back into the garage. It waits for people in its lane.
 * @param {THREE.Group} group
 * @param {THREE.Material} material
 * @param {import('./buildings/index.js').BuildingRecord} post
 * @param {{ occupied: Pedestrians }} people
 */
function createTruckRun(group, material, post, people) {
  const gx = post.anchors.garage.x;
  const gz = post.anchors.garage.z - 2.4;
  const ave = tileToWorld(0, 9).z;
  const south = tileToWorld(0, 16).z;
  const north = tileToWorld(0, 3).z;
  const westCol = tileToWorld(9, 0).x;
  const eastCol = tileToWorld(16, 0).x;
  const ring = tileToWorld(23, 0).x;
  const centre = [
    { x: gx, z: gz }, { x: gx, z: ave }, { x: westCol, z: ave }, { x: westCol, z: south }, { x: ring, z: south },
    { x: ring, z: north }, { x: eastCol, z: north }, { x: eastCol, z: ave }, { x: gx, z: ave }, { x: gx, z: gz },
  ];
  const path = createPath(roundCorners(offsetPolyline(centre, LANE, false), 1.1, false, 6), false);
  const mesh = createMailTruck(material);
  mesh.visible = false;
  group.add(mesh);
  const door = post.root.getObjectByName('garage-door');
  const at = { x: 0, z: 0, angle: 0 };
  const position = new THREE.Vector3();
  const s = { running: false, dist: 0, doorOpen: 0, queued: false };
  return {
    /** Where the truck is while it drives, else null. */
    position() {
      return mesh.visible ? position.set(at.x, 0, at.z) : null;
    },
    request() {
      if (s.running) s.queued = true;
      else Object.assign(s, { running: true, dist: 0 });
    },
    /** @param {number} dt */
    update(dt) {
      const nearGarage = s.running && (s.dist < 3.5 || s.dist > path.length - 3.5);
      s.doorOpen = Math.max(0, Math.min(1, s.doorOpen + (nearGarage ? dt : -dt) * 2.5));
      if (door) door.scale.y = 1 - 0.92 * s.doorOpen;
      if (!s.running) return;
      if (s.doorOpen < 0.9 && s.dist < 0.1) return;
      if (mesh.visible && laneBlocked(path, s.dist, people.occupied, YIELD_REACH)) return;
      s.dist = Math.min(path.length, s.dist + dt * 3.6);
      path.sample(s.dist, at);
      put(mesh, at);
      mesh.visible = true;
      if (s.dist < path.length) return;
      s.running = false;
      mesh.visible = false;
      if (s.queued) Object.assign(s, { queued: false, running: true, dist: 0 });
    },
  };
}

/**
 * The cargo boat's trip from the open sea to the pier, and the moored boats bobbing.
 * @param {THREE.Group} group
 * @param {THREE.Material} material
 */
function createBoats(group, material) {
  const level = SEA.level;
  const dockX = PIER.x + PIER.w / 2 + 0.62;
  const inbound = createPath(roundCorners([
    { x: dockX + 3.5, z: -36.2 }, { x: dockX + 3.0, z: -31.5 }, { x: dockX, z: -29.5 }, { x: dockX, z: -26.2 },
  ], 2.2, false, 8), false);
  const outbound = createPath(roundCorners([
    { x: dockX, z: -26.2 }, { x: dockX, z: -24.6 }, { x: dockX + 3.6, z: -24.8 }, { x: dockX + 4.6, z: -30 }, { x: dockX + 5, z: -36.2 },
  ], 1.8, false, 8), false);
  const cargo = createCargoBoat(material);
  cargo.visible = false;
  group.add(cargo);
  const moored = createMooredBoats(material);
  moored[0].position.set(PIER.x - PIER.w / 2 - 0.55, level, -27.4);
  moored[0].rotation.y = Math.PI / 2;
  moored[1].position.set(PIER.x - PIER.w / 2 - 0.5, level, -30.2);
  moored[1].rotation.y = -Math.PI / 2;
  group.add(...moored);
  const at = { x: 0, z: 0, angle: 0 };
  /** @type {VehicleAction[]} */
  const queue = [];
  const s = { state: 'hidden', t: 0, dwell: -1 };

  /** @param {VehicleAction} action */
  function start(action) {
    if (action === 'depart') Object.assign(s, { state: 'departing', t: 0 });
    else Object.assign(s, { state: 'arriving', t: 0, dwell: action === 'trip' ? 4 : -1 });
  }

  return {
    /** @param {VehicleAction} action */
    request(action) {
      const idle = s.state === 'hidden' || (s.state === 'docked' && action === 'depart');
      if (idle && !(s.state === 'hidden' && action === 'depart')) start(action);
      else if (queue.length < 2) queue.push(action);
    },
    /** @param {number} dt @param {number} elapsed @param {boolean} calm */
    update(dt, elapsed, calm) {
      const amp = calm ? 0.4 : 1;
      for (let i = 0; i < moored.length; i++) {
        moored[i].position.y = level + Math.sin(elapsed * 1.3 + i * 2) * 0.03 * amp;
        moored[i].rotation.x = Math.sin(elapsed * 1.1 + i) * 0.04 * amp;
      }
      stepCargo(dt, elapsed, amp);
    },
  };

  /** @param {number} dt @param {number} elapsed @param {number} amp */
  function stepCargo(dt, elapsed, amp) {
    if (s.state === 'docked') {
      if (s.dwell >= 0 && (s.dwell -= dt) < 0) start('depart');
      else if (queue[0] === 'depart') start(/** @type {VehicleAction} */ (queue.shift()));
    } else if (s.state === 'hidden') {
      const next = queue.shift();
      if (next && next !== 'depart') start(next);
    } else {
      const path = s.state === 'arriving' ? inbound : outbound;
      s.t = Math.min(1, s.t + dt / (s.state === 'arriving' ? 8 : 9));
      const k = s.state === 'arriving' ? 1 - Math.pow(1 - s.t, 2) : s.t * s.t;
      path.sample(k * path.length, at);
      put(cargo, at, level);
      // Fade in and out at the edge of the plinth by scaling the boat.
      const edge = Math.min(1, (at.z + 36.5) / 1.5);
      cargo.scale.setScalar(Math.max(0.001, edge));
      cargo.visible = true;
      if (s.t >= 1) {
        s.state = s.state === 'arriving' ? 'docked' : 'hidden';
        cargo.visible = s.state === 'docked';
      }
    }
    if (cargo.visible) {
      cargo.position.y = level + Math.sin(elapsed * 1.6) * 0.025 * amp;
      cargo.rotation.x = Math.sin(elapsed * 1.2) * 0.03 * amp;
    }
  }
}
