// The people of a team town (CONTRACTS §4.11): the host and up to five teammates, each with a
// home slot (0–5, core/town-map.js HOMES), a colour (an index into the crew colours) and the
// profile they chose in the "You" dialog. Kept in <ANDARY_HOME>/people.json (mode 0600):
//   { v: 1, host: "Sam", people: { "Sam": { slot, color, profile|null }, "Lina": { … } } }
// `andary team invite` and `team remove` edit the file while the town runs; the host's server
// reads it again when it changes, so a removal revokes that person's key and link at once. The
// pure functions below edit a roster value; createPeople is the running host's view of the file.
import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureHome } from './state-file.mjs';
import { cleanMemberName } from './team.mjs';
import { HOME_COUNT } from '../public/js/core/town-map.js';
import { PERSON_COLOR_COUNT, validateProfile } from '../public/js/core/profile.js';

/** The host plus five teammates: one per home. */
export const MAX_PEOPLE = HOME_COUNT;
const PEOPLE_FILE = 'people.json';
/** Most bytes people.json may take (six profiles of 512 bytes, names and slots). */
const MAX_FILE_BYTES = 16 * 1024;
/** How often one person may change their profile. */
export const PROFILE_EVERY_MS = 10_000;

/**
 * @typedef {object} Person
 * @property {number} slot     their home, 0–5
 * @property {number} color    their colour, 0–7, never shared with another person
 * @property {import('../public/js/core/profile.js').Profile|null} profile  null until they choose one
 */

/** @typedef {{ v: 1, host: string|null, people: Record<string, Person> }} Roster */

/** @returns {Roster} */
export function emptyRoster() {
  return { v: 1, host: null, people: {} };
}

/** @param {string} home */
export function peoplePath(home) {
  return join(home, PEOPLE_FILE);
}

/**
 * The roster in people.json: empty when the file is missing or unreadable; entries that are not
 * well formed (a bad name, a slot or colour out of range or taken twice, a bad profile) are
 * dropped or cleared, so a hand-edited file can never break the town.
 * @param {string} home
 * @returns {Roster}
 */
export function readRoster(home) {
  let raw;
  try {
    const text = readFileSync(peoplePath(home), 'utf8');
    raw = text.length <= MAX_FILE_BYTES ? JSON.parse(text) : null;
  } catch {
    return emptyRoster();
  }
  const roster = emptyRoster();
  if (!raw || typeof raw !== 'object' || typeof raw.people !== 'object' || !raw.people) return roster;
  const slots = new Set();
  const colors = new Set();
  for (const [name, entry] of Object.entries(raw.people)) {
    if (Object.keys(roster.people).length >= MAX_PEOPLE || cleanMemberName(name) !== name) continue;
    const { slot, color } = entry ?? {};
    if (!isIndex(slot, MAX_PEOPLE) || slots.has(slot) || !isIndex(color, PERSON_COLOR_COUNT) || colors.has(color)) continue;
    slots.add(slot);
    colors.add(color);
    const check = entry.profile ? validateProfile(entry.profile) : null;
    roster.people[name] = { slot, color, profile: check?.ok ? check.profile : null };
  }
  roster.host = typeof raw.host === 'string' && Object.hasOwn(roster.people, raw.host) ? raw.host : null;
  return roster;
}

/**
 * Writes people.json atomically (temp file + rename) with mode 0600.
 * @param {string} home
 * @param {Roster} roster
 */
export function writeRoster(home, roster) {
  ensureHome(home);
  const target = peoplePath(home);
  const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temp, `${JSON.stringify(roster, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(temp, 0o600);
  renameSync(temp, target);
}

/** @param {unknown} value @param {number} count @returns {value is number} */
function isIndex(value, count) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0 && /** @type {number} */ (value) < count;
}

/**
 * The first free value from `from` on, in order and wrapping round; -1 when all are taken.
 * @param {Set<number>} taken @param {number} count @param {number} [from]
 */
function nextFree(taken, count, from = 0) {
  for (let i = 0; i < count; i++) {
    const value = (from + i) % count;
    if (!taken.has(value)) return value;
  }
  return -1;
}

/** @param {Roster} roster @param {string} [except] @param {'slot'|'color'} field */
function takenBy(roster, field, except) {
  return new Set(Object.entries(roster.people).filter(([name]) => name !== except).map(([, person]) => person[field]));
}

/**
 * Adds a person, with the first free home and colour. A teammate never takes the last place
 * while the roster has no host: the host always has a home.
 * @param {Roster} roster
 * @param {string} name  already cleaned
 * @param {{ host?: boolean }} [options]
 * @returns {{ ok: boolean, roster?: Roster, added?: boolean, error?: string }}
 */
export function addPerson(roster, name, { host = false } = {}) {
  if (Object.hasOwn(roster.people, name)) {
    if (host && roster.host !== name) return { ok: false, error: `${name} is already a teammate: choose another name for yourself with --name.` };
    return { ok: true, roster, added: false };
  }
  const count = Object.keys(roster.people).length;
  const room = MAX_PEOPLE - (host || roster.host ? 0 : 1);
  if (count >= room) return { ok: false, error: `A team town has room for ${MAX_PEOPLE} people, the host included. Remove someone first with: andary team remove <name>` };
  const person = { slot: nextFree(takenBy(roster, 'slot'), MAX_PEOPLE), color: nextFree(takenBy(roster, 'color'), PERSON_COLOR_COUNT), profile: null };
  return { ok: true, roster: { ...roster, host: host ? name : roster.host, people: { ...roster.people, [name]: person } }, added: true };
}

/**
 * Names the host. With another host already on the roster, it is renamed (keeping its home,
 * colour and profile).
 * @param {Roster} roster
 * @param {string|null} name  already cleaned; null keeps the current host, or names one "Host"
 * @returns {{ ok: boolean, roster?: Roster, error?: string }}
 */
export function claimHost(roster, name) {
  const wanted = name ?? roster.host ?? 'Host';
  if (roster.host === wanted) return { ok: true, roster };
  if (roster.host && !Object.hasOwn(roster.people, wanted)) {
    const { [roster.host]: entry, ...others } = roster.people;
    return { ok: true, roster: { ...roster, host: wanted, people: { ...others, [wanted]: entry } } };
  }
  const result = addPerson(roster, wanted, { host: true });
  return result.ok ? { ok: true, roster: result.roster } : result;
}

/**
 * Takes a person off the roster; the host cannot be removed.
 * @param {Roster} roster
 * @param {string} name
 * @returns {{ ok: boolean, roster?: Roster, error?: string }}
 */
export function removePerson(roster, name) {
  if (!Object.hasOwn(roster.people, name)) return { ok: false, error: `${name} is not on the team.` };
  if (roster.host === name) return { ok: false, error: `${name} hosts the town and cannot be removed.` };
  const { [name]: _removed, ...others } = roster.people;
  return { ok: true, roster: { ...roster, people: others } };
}

/**
 * Saves a person's profile. They get the colour they asked for when nobody else has it, else
 * the next free one in order.
 * @param {Roster} roster
 * @param {string} name
 * @param {import('../public/js/core/profile.js').Profile} profile  already validated
 * @returns {{ roster: Roster, color: number }|null}  null: not on the roster
 */
export function setProfile(roster, name, profile) {
  if (!Object.hasOwn(roster.people, name)) return null;
  const color = nextFree(takenBy(roster, 'color', name), PERSON_COLOR_COUNT, profile.color);
  const person = { ...roster.people[name], color, profile };
  return { roster: { ...roster, people: { ...roster.people, [name]: person } }, color };
}

/**
 * @typedef {object} PersonView  what every browser of the town is told about a person
 * @property {string} name
 * @property {number} slot
 * @property {number} color
 * @property {boolean} host
 * @property {import('../public/js/core/profile.js').Profile|null} profile
 */

/**
 * The running host's people: people.json, read again whenever it changes on disk (the CLI edits
 * it), and written when someone saves a profile.
 * @param {{ home: string, host: string|null, onChange?: () => void, now?: () => number }} options
 *   host: the name from `andary start --team --name`
 */
export function createPeople({ home, host, onChange = () => {}, now = Date.now }) {
  const claimed = claimHost(readRoster(home), host);
  if (!claimed.ok) throw Object.assign(new Error(claimed.error), { code: 'EPEOPLE' });
  let roster = claimed.roster;
  writeRoster(home, roster);
  let stamp = fileStamp(home);
  /** @type {Map<string, number>} when each person last saved a profile */
  const saved = new Map();

  /** Reads the file again if it changed; true when the roster did. */
  function refresh() {
    const next = fileStamp(home);
    if (next === stamp) return false;
    stamp = next;
    const before = JSON.stringify(roster);
    // The host stays the host even if the file lost it.
    const reread = claimHost(readRoster(home), roster.host);
    roster = reread.ok ? reread.roster : readRoster(home);
    return JSON.stringify(roster) !== before;
  }

  return {
    get host() {
      return roster.host;
    },
    /** Reads people.json again; tells onChange when someone was added, removed or changed. */
    poll() {
      if (refresh()) onChange();
    },
    /** Whether a name is on the roster now (a key or link of anyone else is refused). @param {string|null} name */
    has(name) {
      refresh();
      return typeof name === 'string' && Object.hasOwn(roster.people, name);
    },
    /** @returns {PersonView[]} by home slot */
    list() {
      return Object.entries(roster.people)
        .map(([name, person]) => ({ name, slot: person.slot, color: person.color, host: name === roster.host, profile: person.profile }))
        .sort((a, b) => a.slot - b.slot);
    },
    /**
     * Saves a validated profile; null when the name is not on the roster or saved one less than
     * PROFILE_EVERY_MS ago (then `wait` says so).
     * @param {string} name
     * @param {import('../public/js/core/profile.js').Profile} profile
     * @returns {{ color: number } | { wait: true } | null}
     */
    setProfile(name, profile) {
      refresh();
      const last = saved.get(name);
      if (last !== undefined && now() - last < PROFILE_EVERY_MS) return { wait: true };
      const result = setProfile(roster, name, profile);
      if (!result) return null;
      saved.set(name, now());
      roster = result.roster;
      writeRoster(home, roster);
      stamp = fileStamp(home);
      onChange();
      return { color: result.color };
    },
  };
}

/** @param {string} home */
function fileStamp(home) {
  try {
    const stat = statSync(peoplePath(home));
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return 'missing';
  }
}

/** @typedef {ReturnType<typeof createPeople>} People */
