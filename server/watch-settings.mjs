// The cost and long-turn alerts' settings (core/watch.js), as the owner set them in the town, kept
// in <ANDARY_HOME>/watch.json so the phone notes follow them after a restart too. Read
// defensively: a damaged or missing file is the defaults.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readWatchSettings } from '../public/js/core/watch.js';

/**
 * @param {string|null} file
 * @returns {import('../public/js/core/watch.js').WatchSettings}
 */
export function loadWatchSettings(file) {
  if (!file || !existsSync(file)) return readWatchSettings(null);
  try {
    return readWatchSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return readWatchSettings(null);
  }
}

/**
 * Writes the settings atomically (0600); on failure they last until the server stops.
 * @param {string|null} file
 * @param {import('../public/js/core/watch.js').WatchSettings} settings
 */
export function saveWatchSettings(file, settings) {
  if (!file) return;
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(settings), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  } catch {
    // kept in memory
  }
}
