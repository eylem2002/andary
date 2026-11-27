// `andary status`: is the server up, and where are the hooks registered?
import { readVersion, resolveHome } from '../config.mjs';
import { inspectInstallations } from '../installer.mjs';
import { isProcessAlive, loginUrl, probeServer, readStateFile, serverOrigin } from '../state-file.mjs';
import { cliInvocation, tildify } from './io.mjs';

/**
 * @param {Record<string, any>} _values
 * @param {string[]} _positionals
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>} 0 when the server is running, 1 otherwise
 */
export async function runStatus(_values, _positionals, io) {
  const home = resolveHome(io.env);
  const state = readStateFile(home);
  const hello = state && isProcessAlive(state.pid) ? await probeServer(state, 1500, { token: state.uiToken }) : null;
  io.out(`Andary ${readVersion()}`);
  if (hello && state) {
    io.out(`  Server:    running on ${serverOrigin(state)} (pid ${state.pid}, up ${formatDuration(Date.now() - state.startedAt)})`);
    io.out(`  Sign in:   ${loginUrl(state)}`);
    io.out(`  Approvals: remote approvals ${hello.settings?.remoteApprovals ? 'on' : 'off'}`);
  } else {
    const stale = state ? ' (server.json is left over from a server that is gone)' : '';
    io.out(`  Server:    not running${stale}. Start it with: ${cliInvocation()} start`);
  }
  const report = inspectInstallations({ dir: io.cwd, env: io.env, home });
  for (const scope of report.scopes) io.out(`  Hooks:     ${describeScope(scope)}`);
  io.out(`  Plugin:    ${report.plugin ? 'enabled' : 'not enabled'}`);
  io.out(`  Home:      ${tildify(home)}`);
  return hello ? 0 : 1;
}

/**
 * @param {import('../installer.mjs').ScopeReport} report
 * @returns {string}
 */
export function describeScope(report) {
  const where = tildify(report.settingsPath);
  const which = `${report.client.name}, ${report.scope} scope`;
  if (report.error) return `${which}: cannot read ${where}`;
  if (report.events.length === 0) return `${which}: not installed (${where})`;
  if (report.complete) return `${which}: installed (${where})`;
  const client = report.client.id === 'claude' ? '' : ` ${report.client.id}`;
  const scope = report.scope === 'user' ? '' : ` --scope ${report.scope}`;
  const again = `install${client}${scope}`;
  const events = new Set(report.client.registrations.map((r) => r.event)).size;
  if (report.holdMissing && report.events.length === events) return `${which}: installed, but the hold check is missing (${where}); run ${again} again`;
  return `${which}: partly installed, ${report.events.length} of ${events} events (${where}); run ${again} again`;
}

/**
 * @param {number} ms
 * @returns {string} e.g. "3h 12m", "4m", "12s"
 */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
