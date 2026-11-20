// Command dispatch for bin/andary.mjs.
import { parseArgs } from 'node:util';
import { readVersion } from '../config.mjs';
import { runDoctor } from './doctor.mjs';
import { HOOKS_OPTIONS, runInstall, runUninstall } from './hooks.mjs';
import { processIo } from './io.mjs';
import { UsageError } from './options.mjs';
import { REPLAY_OPTIONS, runReplay } from './replay.mjs';
import { SIMULATE_OPTIONS, runSimulate } from './simulate.mjs';
import { START_OPTIONS, runStart, runStop } from './start.mjs';
import { runStatus } from './status.mjs';
import { TEAM_OPTIONS, runTeam } from './team.mjs';

const START_HELP = `Options:
  -p, --port <n>            Port to listen on (default 4747, or ANDARY_PORT; 0 = any free port)
      --host <address>      Interface to bind (default 127.0.0.1; anything else exposes the town)
      --no-open             Do not open a browser
      --notify              Phone notifications through the free ntfy app (a private topic
                            on ntfy.sh, kept in ~/.andary/notify.json)
      --notify-url <url>    Your own ntfy topic URL instead (or ANDARY_NOTIFY_URL)
      --team                Host a team town: teammates' Andarys can share their sessions here
                            (listens on your network unless --host says otherwise)
      --team-host <name>    Another name teammates reach this town by, e.g. a Tailscale name
      --share-to <address>  Share your sessions with a team town (or ANDARY_SHARE_TO)
      --team-key <key>      Your key from "andary team invite" on the host (better: put it in
                            ANDARY_TEAM_KEY, so it stays out of ps and your shell history)
      --remote-approvals    Let the town answer Claude Code's permission prompts
      --approval-timeout <s>
                            Seconds a prompt waits for the town before the terminal asks
                            (default 120, at most 140)
      --record              Also write every event to ~/.andary/recordings (holds prompts and commands)
      --detach              Run the server in the background and return`;

const HOOKS_HELP = `Options:
  -s, --scope <scope>       user (default: ~/.claude/settings.json, every project),
                            project (<dir>/.claude/settings.json, shared with the repository) or
                            local (<dir>/.claude/settings.local.json, this project, just you)
      --dir <path>          Project folder for the project and local scopes (default: current folder)
      --dry-run             Show what would change and write nothing
      --print               Print the hooks JSON to merge by hand and write nothing`;

/**
 * @typedef {object} Command
 * @property {string} usage
 * @property {string} summary
 * @property {string} [help]
 * @property {Record<string, any>} options      parseArgs option definitions
 * @property {boolean} [positionals]
 * @property {(values: Record<string, any>, positionals: string[], io: import('./io.mjs').CliIo) => Promise<number>} run
 */

/** @type {Record<string, Command>} */
const COMMANDS = {
  start: {
    usage: 'start [options]',
    summary: 'Start the town server and open it in your browser (the default command)',
    help: START_HELP,
    options: START_OPTIONS,
    run: (values, positionals, io) => runStart(values, positionals, io),
  },
  demo: {
    usage: 'demo [options]',
    summary: 'Start the server and open the built-in simulation',
    help: START_HELP,
    options: START_OPTIONS,
    run: (values, positionals, io) => runStart(values, positionals, io, { demo: true }),
  },
  stop: { usage: 'stop', summary: 'Stop the running server', options: {}, run: runStop },
  install: {
    usage: 'install [options]',
    summary: 'Register the Claude Code hooks that feed the town',
    help: HOOKS_HELP,
    options: HOOKS_OPTIONS,
    run: runInstall,
  },
  uninstall: {
    usage: 'uninstall [options]',
    summary: 'Remove the Andary hooks (and nothing else)',
    help: HOOKS_HELP,
    options: HOOKS_OPTIONS,
    run: runUninstall,
  },
  team: {
    usage: 'team invite <name> | team reset',
    summary: 'On a team host: print a teammate\'s key and the view link, or revoke them all',
    help: 'Options:\n      --url <address>       The address teammates reach this computer at (default: its\n                            network address and the running port), e.g. a Tailscale name',
    options: TEAM_OPTIONS,
    positionals: true,
    run: runTeam,
  },
  status: { usage: 'status', summary: 'Show whether the server runs and where hooks are installed', options: {}, run: runStatus },
  doctor: { usage: 'doctor', summary: 'Check the whole pipeline end to end and suggest fixes', options: {}, run: runDoctor },
  replay: {
    usage: 'replay <file.jsonl> [--speed N]',
    summary: 'Send a recording made with --record to the running town',
    help: 'Options:\n      --speed <n>           Playback speed (default 1)',
    options: REPLAY_OPTIONS,
    positionals: true,
    run: runReplay,
  },
  simulate: {
    usage: 'simulate [--speed N] [--seed N]',
    summary: 'Send simulated Claude Code sessions to the running town',
    help: 'Options:\n      --speed <n>           Simulation speed (default 1)\n      --seed <n>            Seed for a repeatable run',
    options: SIMULATE_OPTIONS,
    run: (values, positionals, io) => runSimulate(values, positionals, io),
  },
};

const VERSION_ARGS = ['--version', '-v', 'version'];
const HELP_ARGS = ['--help', '-h', 'help'];

/** @returns {string} */
function generalHelp() {
  const width = Math.max(...Object.values(COMMANDS).map((c) => c.usage.length));
  const lines = Object.values(COMMANDS).map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`);
  return `Andary ${readVersion()}: watch your Claude Code agents work in a living 3D town.

Usage: andary [command] [options]

Commands:
${lines.join('\n')}

Run "andary <command> --help" for a command's options.

Environment:
  ANDARY_HOME     Folder for server.json, the hook forwarder and recordings (default ~/.andary)
  ANDARY_PORT     Default port (default 4747)
  CLAUDE_CONFIG_DIR   Claude Code's settings folder (default ~/.claude)`;
}

/**
 * @param {Command} command
 * @returns {string}
 */
function commandHelp(command) {
  return `Usage: andary ${command.usage}\n\n${command.summary}.${command.help ? `\n\n${command.help}` : ''}`;
}

/**
 * Runs the CLI and returns its exit code (0 ok, 1 failure, 2 usage error).
 * @param {string[]} argv arguments after the script name
 * @param {import('./io.mjs').CliIo} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = processIo()) {
  const [first] = argv;
  if (VERSION_ARGS.includes(first)) {
    io.out(readVersion());
    return 0;
  }
  if (HELP_ARGS.includes(first)) {
    io.out(generalHelp());
    return 0;
  }
  // No command, or options first: `andary --port 5000` means start.
  const named = first !== undefined && !first.startsWith('-');
  const name = named ? first : 'start';
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) {
    io.err(`Unknown command "${name}". Run "andary --help" to see the commands.`);
    return 2;
  }
  try {
    return await runCommand(command, named ? argv.slice(1) : argv, io);
  } catch (error) {
    if (!(error instanceof UsageError) && !String(error?.code).startsWith('ERR_PARSE_ARGS')) throw error;
    io.err(`${error.message}\nRun "andary ${name} --help" for usage.`);
    return 2;
  }
}

/**
 * Parses a command's options and runs it, or prints its usage for `--help`.
 * @param {Command} command
 * @param {string[]} args the arguments after the command name
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
async function runCommand(command, args, io) {
  const { values, positionals } = parseArgs({
    args,
    options: { ...command.options, help: { type: 'boolean', short: 'h' } },
    allowPositionals: Boolean(command.positionals),
    strict: true,
  });
  if (values.help) {
    io.out(commandHelp(command));
    return 0;
  }
  return command.run(values, positionals, io);
}
