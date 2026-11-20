// What this page load was opened with, read once before anything is built: the town's look (from
// ?look= or the saved preference). The HUD and the town's environment both read it here, so
// core/ stays free of browser state (docs/ARCHITECTURE.md).
import { readLook } from './core/looks.js';

/** @typedef {import('./core/looks.js').LookId} LookId */

/** The look this page was built with; changing it reloads the page. */
export const LOOK = readLook(globalThis.location?.search ?? '', safeStorage());

/** @returns {Storage|null} */
function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
