// `andary team invite <name>`, `team remove <name>`, `team view-link` and `team reset` (CONTRACTS
// §4.11). Run on the computer that hosts the team town (`andary start --team`). Invite and remove
// edit people.json; a running town reads it again within seconds.
import { resolveHome, DEFAULT_PORT } from '../config.mjs';
import { addPerson, readRoster, removePerson, writeRoster } from '../people.mjs';
import { readStateFile } from '../state-file.mjs';
import { cleanMemberName, lanAddresses, memberKey, personToken, teamSecret, viewToken } from '../team.mjs';
import { cliInvocation } from './io.mjs';
import { UsageError, parseTeamUrl } from './options.mjs';

export const TEAM_OPTIONS = Object.freeze({
  url: { type: 'string' },
});

/**
 * @param {Record<string, any>} values
 * @param {string[]} positionals  invite <name> | remove <name> | view-link | reset
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
export async function runTeam(values, positionals, io) {
  const [action, ...rest] = positionals;
  const home = resolveHome(io.env);
  if (action === 'invite') return invite(teammateName(rest), values, home, io);
  if (action === 'remove') return remove(teammateName(rest), home, io);
  if (action === 'view-link') return viewLink(values, home, io);
  if (action === 'reset') {
    teamSecret(home, { fresh: true });
    io.out('Made a new team secret: every invite key, personal link and the view link stopped working.');
    io.out(`Restart the team town, then send everyone their new lines with: ${cliInvocation()} team invite <name>`);
    return 0;
  }
  throw new UsageError('Use "andary team invite <name>", "team remove <name>", "team view-link" or "team reset".');
}

/** @param {string[]} words */
function teammateName(words) {
  const name = cleanMemberName(words.join(' '));
  if (!name) throw new UsageError('Give the teammate a name: letters, digits, spaces, dots, dashes or underscores (at most 24).');
  return name;
}

/**
 * The base address teammates reach the town at.
 * @param {Record<string, any>} values
 * @param {import('../state-file.mjs').ServerState|null} state
 */
function baseAddress(values, state) {
  const port = state?.port ?? DEFAULT_PORT;
  const lan = lanAddresses()[0];
  // With a certificate, the address must be the name on it (the first --team-host).
  const scheme = state?.tls ? 'https' : 'http';
  const address = state?.tls ? (state.teamHosts?.[0] ?? lan) : lan;
  return { base: values.url ? parseTeamUrl(values.url, '--url') : `${scheme}://${address ?? '127.0.0.1'}:${port}`, lan };
}

/**
 * @param {string} name
 * @param {Record<string, any>} values
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 */
function invite(name, values, home, io) {
  const added = addPerson(readRoster(home), name);
  if (!added.ok) throw new UsageError(added.error);
  writeRoster(home, added.roster);
  const secret = /** @type {string} */ (teamSecret(home));
  const state = readStateFile(home);
  const { base, lan } = baseAddress(values, state);
  // The key goes in the environment: as an argument it would sit in ps and the shell history.
  const command = `ANDARY_TEAM_KEY=${memberKey(secret, name)} andary start --share-to ${base}`;
  io.out(`Invite for ${name}. Send them these two lines privately: the key lets anyone add sessions to your town as ${name},`);
  io.out(`and the link lets anyone open the town as ${name} and change ${name}'s character.`);
  io.out('');
  io.out('  To share their Claude Code and Codex sessions with the team town, they run:');
  io.out(`    ${command}`);
  io.out('  (In PowerShell: $env:ANDARY_TEAM_KEY="<key>"; andary start --share-to <address>)');
  io.out(`  Their personal link to the team town, where they have a character and a home:`);
  io.out(`    ${base}/?me=${encodeURIComponent(personToken(secret, name))}`);
  io.out('');
  io.out('Whoever has a personal link or the view link sees every crew\'s prompts, commands, file paths');
  io.out('and edits, yours included, over plain HTTP: share them only with the team, on a network you trust.');
  io.out(`${Object.keys(added.roster.people).length} of 6 homes taken. The view-only link for anyone else: ${cliInvocation()} team view-link`);
  if (!values.url && !lan) io.out('No network address found: pass the address teammates use with --url http://<address>:<port>.');
  if (!state) io.out(`The team town is not running: start it with ${cliInvocation()} start --team`);
  else if (!state.team) io.out(`The running town is not a team host: restart it with ${cliInvocation()} start --team`);
  const host = new URL(base).hostname;
  if (values.url && !/^[\d.]+$/.test(host)) io.out(`For the view link to work at ${host}, start the team town with --team-host ${host}`);
  io.out(`Revoke ${name}'s key and link with: ${cliInvocation()} team remove ${name}; everyone's with: ${cliInvocation()} team reset`);
  return 0;
}

/**
 * @param {string} name
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 */
function remove(name, home, io) {
  const removed = removePerson(readRoster(home), name);
  if (!removed.ok) throw new UsageError(removed.error);
  writeRoster(home, removed.roster);
  io.out(`Removed ${name}: their key and personal link stopped working, and their home is free again.`);
  return 0;
}

/**
 * @param {Record<string, any>} values
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 */
function viewLink(values, home, io) {
  const secret = /** @type {string} */ (teamSecret(home));
  const { base } = baseAddress(values, readStateFile(home));
  io.out('The team town\'s view-only link (no character, no home):');
  io.out(`  ${base}/?view=${viewToken(secret)}`);
  io.out('Whoever has it sees every crew\'s prompts, commands, file paths and edits: share it only with the team.');
  return 0;
}
