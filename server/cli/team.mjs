// `andary team invite <name>` and `andary team reset` (CONTRACTS §4.11). Run on the computer that
// hosts the team town (`andary start --team`).
import { resolveHome, DEFAULT_PORT } from '../config.mjs';
import { readStateFile } from '../state-file.mjs';
import { cleanMemberName, lanAddresses, memberKey, teamSecret, viewToken } from '../team.mjs';
import { cliInvocation } from './io.mjs';
import { UsageError, parseTeamUrl } from './options.mjs';

export const TEAM_OPTIONS = Object.freeze({
  url: { type: 'string' },
});

/**
 * @param {Record<string, any>} values
 * @param {string[]} positionals  invite <name> | reset
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
export async function runTeam(values, positionals, io) {
  const [action, ...rest] = positionals;
  const home = resolveHome(io.env);
  if (action === 'invite') return invite(rest.join(' '), values, home, io);
  if (action === 'reset') {
    teamSecret(home, { fresh: true });
    io.out('Made a new team secret: every invite key and the view link stopped working.');
    io.out(`Restart the team town, then invite people again with: ${cliInvocation()} team invite <name>`);
    return 0;
  }
  throw new UsageError('Use "andary team invite <name>" or "andary team reset".');
}

/**
 * @param {string} rawName
 * @param {Record<string, any>} values
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 */
function invite(rawName, values, home, io) {
  const name = cleanMemberName(rawName);
  if (!name) throw new UsageError('Give the teammate a name: letters, digits, spaces, dots, dashes or underscores (at most 24).');
  const secret = /** @type {string} */ (teamSecret(home));
  const state = readStateFile(home);
  const port = state?.port ?? DEFAULT_PORT;
  const lan = lanAddresses()[0];
  // With a certificate, the address must be the name on it (the first --team-host).
  const scheme = state?.tls ? 'https' : 'http';
  const address = state?.tls ? (state.teamHosts?.[0] ?? lan) : lan;
  const base = values.url ? parseTeamUrl(values.url, '--url') : `${scheme}://${address ?? '127.0.0.1'}:${port}`;
  // The key goes in the environment: as an argument it would sit in ps and the shell history.
  const command = `ANDARY_TEAM_KEY=${memberKey(secret, name)} andary start --share-to ${base}`;
  io.out(`Invite for ${name}. Send them these two lines privately: the key lets anyone add sessions to your town as ${name}.`);
  io.out('');
  io.out('  To share their Claude Code and Codex sessions with the team town, they run:');
  io.out(`    ${command}`);
  io.out('  (In PowerShell: $env:ANDARY_TEAM_KEY="<key>"; andary start --share-to <address>)');
  io.out('  To watch the team town in a browser (view only):');
  io.out(`    ${base}/?view=${viewToken(secret)}`);
  io.out('');
  io.out('Whoever has the view link sees every crew\'s prompts, commands, file paths and edits, yours');
  io.out('included, over plain HTTP: share it only with the team, on a network you trust.');
  if (!values.url && !lan) io.out('No network address found: pass the address teammates use with --url http://<address>:<port>.');
  if (!state) io.out(`The team town is not running: start it with ${cliInvocation()} start --team`);
  else if (!state.team) io.out(`The running town is not a team host: restart it with ${cliInvocation()} start --team`);
  const host = new URL(base).hostname;
  if (values.url && !/^[\d.]+$/.test(host)) io.out(`For the view link to work at ${host}, start the team town with --team-host ${host}`);
  io.out(`Revoke every key and the view link with: ${cliInvocation()} team reset`);
  return 0;
}
