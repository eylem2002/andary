// `andary simulate`: runs the UI's simulation (CONTRACTS §7) in Node and sends its hook
// payloads to the running town, so the whole live pipeline can be watched without Claude Code.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SIMULATION_MODULE, resolveHome } from '../config.mjs';
import { findRunningServer, serverOrigin } from '../state-file.mjs';
import { postHook } from './client.mjs';
import { cliInvocation } from './io.mjs';
import { parseSeed, parseSpeed } from './options.mjs';

export const SIMULATE_OPTIONS = Object.freeze({ speed: { type: 'string' }, seed: { type: 'string' } });

/**
 * @param {Record<string, any>} values
 * @param {string[]} _positionals
 * @param {import('./io.mjs').CliIo} io
 * @param {{ modulePath?: string, signal?: AbortSignal }} [deps] for tests: a stub module, a stop signal
 * @returns {Promise<number>}
 */
export async function runSimulate(values, _positionals, io, { modulePath = SIMULATION_MODULE, signal } = {}) {
  const speed = parseSpeed(values.speed);
  const seed = parseSeed(values.seed);
  const createSimulation = await loadSimulation(modulePath, io);
  if (!createSimulation) return 1;
  const state = await findRunningServer(resolveHome(io.env));
  if (!state) {
    io.err(`Andary is not running. Start it first: ${cliInvocation()} start`);
    return 1;
  }

  /** @type {Error|null} */
  let failure = null;
  const lost = new AbortController();
  const emit = async (/** @type {any} */ payload) => {
    try {
      return await emitToServer(state, payload);
    } catch (error) {
      failure ??= error;
      lost.abort();
      return undefined;
    }
  };
  const simulation = createSimulation({ seed, speed, emit });
  simulation.start();
  io.out(`Simulating Claude Code sessions into ${serverOrigin(state)} at ${speed}× speed${seed === undefined ? '' : ` (seed ${seed})`}. Press Ctrl+C to stop.`);
  await waitForStop([lost.signal, signal]);
  simulation.stop();
  if (failure) {
    io.err(`Lost the connection to the town: ${failure.message}`);
    return 1;
  }
  io.out('Simulation stopped.');
  return 0;
}

/**
 * @param {string} modulePath
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<Function|null>}
 */
async function loadSimulation(modulePath, io) {
  if (!existsSync(modulePath)) {
    io.err('The simulation is not available in this copy of Andary (public/js/sim/simulation.js is missing).');
    return null;
  }
  let module;
  try {
    module = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    io.err(`The simulation could not be loaded: ${error.message}`);
    return null;
  }
  if (typeof module.createSimulation !== 'function') {
    io.err('The simulation module does not export createSimulation().');
    return null;
  }
  return module.createSimulation;
}

/**
 * Posts one payload; for PermissionRequest, waits for the town's answer and passes it back to
 * the simulation ({ decision }), or nothing when the town did not decide.
 * @param {import('../state-file.mjs').ServerState} state
 * @param {Record<string, any>} payload
 * @returns {Promise<{ decision: 'allow'|'deny' } | undefined>}
 */
async function emitToServer(state, payload) {
  const permission = payload?.hook_event_name === 'PermissionRequest';
  const { output } = await postHook(state, payload, { timeoutMs: permission ? state.approvalTimeoutMs + 5000 : 5000 });
  if (!permission) return undefined;
  const behavior = output?.hookSpecificOutput?.decision?.behavior;
  return behavior === 'allow' || behavior === 'deny' ? { decision: behavior } : undefined;
}

/**
 * Resolves on SIGINT/SIGTERM or when any of the given signals aborts.
 * @param {Array<AbortSignal|undefined>} signals
 * @returns {Promise<void>}
 */
function waitForStop(signals) {
  return new Promise((resolve) => {
    const finish = () => {
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      for (const signal of signals) signal?.removeEventListener('abort', finish);
      resolve();
    };
    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
    for (const signal of signals) {
      if (signal?.aborted) {
        finish();
        return;
      }
      signal?.addEventListener('abort', finish);
    }
  });
}
