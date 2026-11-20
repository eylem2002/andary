// Quips for the speech bubbles. Lines are templated with real details from the event ({file},
// {cmd}, {pattern}, …); a line is only used when every placeholder it needs has a value, and every
// situation has placeholder-free lines, so a bubble never shows "undefined" or a raw "{file}".
// House style: warm, developer-flavoured, inclusive; the joke is on the code or on the crew
// itself, never on the person at the keyboard.

import { clip, oneLine } from './events.js';

/** @type {Readonly<Record<string, readonly string[]>>} */
const LINES = Object.freeze({
  generic: [
    'Busy, busy, busy.',
    'One thing at a time. Then the next thing.',
    'Making progress, one token at a time.',
    'Just another day at the code mines.',
    'Onwards!',
  ],

  // Sessions and prompts --------------------------------------------------------------------
  'session.start': [
    'Morning, {project}! Hard hat on, coffee pending.',
    'The bus to {project} has arrived. Please mind the gap between spec and implementation.',
    'New crew in town. First job: find out where the README is hiding.',
    'Reporting for duty at {project}, with snacks and a healthy respect for legacy code.',
    "Clocking in. Let's leave {project} nicer than we found it.",
    'Fresh context window, who dis?',
    'Tools unpacked, hard hat polished, curiosity at maximum.',
    "Hello, {project}! I haven't read a line of you yet and I'm already a fan.",
    "Arrived on {model}. Let's build something lovely.",
    'Clocking in. Note to self: read before you write.',
  ],
  'session.resume': [
    "I'm back! Where were we? Oh right: everywhere.",
    'Resuming. The story so far: lots of files, one goal.',
    'Picking up where we left off. The coffee went cold, the code did not.',
    'Back on site at {project}. Nobody touched my scaffolding, I hope.',
  ],
  'session.end': [
    "That's a wrap. Catching the last bus out of {project}.",
    'Clocking out. The code will miss me. The tests, slightly less.',
    'Session over. May all your merges be fast-forwards.',
    'Heading home. Leave a light on for the next prompt.',
    'Bye, {project}! The git log will tell our story.',
    'End of shift. Hard hat back on the hook.',
  ],
  prompt: [
    'New mission: {goal}. Hard hats on!',
    'On it: {goal}.',
    'Copy that: {goal}. Rolling up my sleeves.',
    '{goal}? Ooh. I know just where to start.',
    'Read the brief twice: {goal}. Now to code it once.',
    'New orders! Mobilising the crew.',
    'Got it. Sharpening pencils, warming up the terminal.',
    'A fresh request! My favourite kind.',
  ],

  // Arrivals at buildings -----------------------------------------------------------------
  arrive: [
    'Using {tool}. Right tool, right job.',
    '{tool} time!',
    'On my way. Busy, busy, busy.',
    'Off to the next job.',
  ],
  'arrive.hall': [
    'Town Hall: time to delegate like a pro.',
    'Briefing a new helper. Clipboards ready!',
    'Need a hand? Summoning reinforcements.',
    'Hiring a specialist. Great leads know when to ask for help.',
  ],
  'arrive.library': [
    'Reading {file}. Every file is a mystery novel and I am the detective.',
    'Checking out {file}. Due back in fourteen tokens.',
    'Shh, library voice. Reading {file}.',
    '{file}: strong opening, mysterious middle, cliffhanger TODO.',
    'Reading {file} first. Guessing is for game shows.',
    'Context is king. Reading {file} for the throne.',
    'Reading the code AND the comments. Living dangerously.',
    'One does not simply edit without reading. Opening {file}.',
    'Speed-reading. It is a superpower and a liability.',
  ],
  'arrive.workshop': [
    'Measure twice, edit {file} once.',
    'Hammering {file} into shape. Gently: it might be load-bearing.',
    'A small, surgical edit to {file}. Scalpel. Coffee. Go.',
    'Renovating {file}, keeping all the original features.',
    'A tiny change to {file}. Famous last words, but genuinely tiny.',
    'Editing {file}. Diff incoming, reviewers stand by.',
    'Sanding the rough edges off {file}.',
    'Tightening a few bolts in {file}.',
    'Workshop time. Safety goggles on.',
  ],
  'arrive.write': [
    'Fresh file: {file}. Smells like new sawdust.',
    'Writing {file} from scratch. Blank page, full heart.',
    'Welcome to the codebase, little {file}.',
    'Building {file} from the ground up.',
    'A brand-new file. Let me find a nice spot for it.',
  ],
  'arrive.terminal': [
    '$ {cmd}. Fingers crossed for exit code zero.',
    "Running {cmd}. If it works first try, I'll be suspicious.",
    'Terminal time. The shell and I have an understanding.',
    'Typing {cmd} with the confidence of someone who read the man page.',
    'Pressing Enter like I mean it.',
    '{cmd}. What could possibly go wrong? (Rhetorical.)',
    'To the command line, where every character counts.',
  ],
  'arrive.detective': [
    "Searching for {pattern}. It's always in the last place you grep.",
    'Detective mode: following the {pattern} trail.',
    'Grepping for {pattern}. Elementary, my dear Watson.',
    'Somewhere in this repo, {pattern} is hiding. Not for long.',
    'Dusting the codebase for {pattern} fingerprints.',
    'Magnifying glass out. Who touched {pattern} last?',
    'Search warrant approved. Turning over every file.',
  ],
  'arrive.web': [
    'Asking the internet about {query}. It has opinions.',
    'Fetching {host}. Downloading wisdom, one packet at a time.',
    'Consulting {host}. Trust, but verify.',
    'Searching for {query}. Skipping the answers from 2009.',
    "Reading the docs on {host} so you don't have to.",
    'Off to the Web Tower. Signal strength: excellent.',
    'Looking it up. Even experts check the docs.',
  ],
  'arrive.board': [
    'Updating the plan. A plan is a list of things that will change.',
    'Pinning tasks to the board. Very official. Much organised.',
    'Crossing things off is my cardio.',
    'Planning the work, then working the plan.',
    'To-do list refreshed. Future me says thanks.',
    'Sticky notes: deployed.',
  ],
  'arrive.post': [
    'Stamping the paperwork.',
    'Off to the Post Office with a parcel of work.',
    'Special delivery coming up.',
    'Licking stamps. Metaphorically.',
  ],
  'arrive.harbor': [
    'Docking at the {server} harbor. Unloading {tool}.',
    'Ahoy, {server}! Any cargo for me?',
    'Shipping a request to {server}. Tracking number: optimism.',
    'Calling {server} by boat. The tide is in.',
    'MCP Harbor: where tools arrive by sea.',
  ],
  'arrive.permits': [
    'Need a permit for this one. Safety first.',
    'Taking a number at the Permit Office.',
    'Some things need a human signature. This is one of them.',
  ],
  'arrive.spa': ['Spa day for my context window.', 'Cucumber slices on, token counter off.'],
  'arrive.academy': [
    'Enrolling in {skill}. Back in a minute with a diploma.',
    'Loading the {skill} skill. I know kung fu. Well, {skill}.',
    'Study break at the Academy: {skill}.',
    'New skill unlocked: {skill}. Trying not to show off.',
    'Academy time. Learning from the experts.',
  ],
  'arrive.cafe': ['Café break. Coffee in, ideas out.', 'One flat white, extra context, please.'],
  'arrive.grove': [
    'Planting a worktree. Branches, but literal.',
    'A tree for {name}. Isolation never looked so leafy.',
    'Worktree Grove: where experiments grow safely.',
  ],
  'arrive.station': ['Waiting for the bus. Is it ever on time?', 'Bus stop. Timetable says "soon".'],

  // Special shell commands -----------------------------------------------------------------
  cmd: ['Running a command. Stand clear of the terminal.', 'Shell time!'],
  'cmd.test': [
    'Running the tests. Nobody breathe.',
    'Test time! May the odds be ever green.',
    'Moment of truth: {cmd}.',
    "Running the suite. I've got a good feeling about this.",
    "Tests running. Don't touch anything. Especially the clock.",
  ],
  'cmd.install': [
    'Installing dependencies. Please hold while I download half the internet.',
    '{cmd}: adding another box to the node_modules pile.',
    'node_modules is about to gain mass. Stand back.',
    'Installing packages. The lockfile is about to have feelings.',
  ],
  'cmd.deps': ['Fetching dependencies. Every project needs friends.', '{cmd}. Packages, assemble!'],
  'cmd.git-commit': [
    'Committing. Writing a message future-us will actually understand.',
    'Saving our progress in the history books.',
    'Commit time. Small, focused and well described.',
  ],
  'cmd.git-push': [
    'Pushing to the remote. Mail truck, start your engine!',
    'Shipping it. No force required.',
    'git push: sending our work out into the world.',
  ],
  'cmd.rm-rf': [
    'rm -rf? Triple-checking the path. Then checking it again.',
    'Deleting things on purpose. Deep breath.',
    '{cmd}. Measure twice, delete once.',
    'Careful now: rm -rf has no undo button.',
  ],
  'cmd.docker': [
    'Docker time. It works in my container.',
    'Shipping containers, the software kind.',
    'Spinning up containers: tiny computers inside the computer.',
  ],
  'cmd.curl': [
    'curl-ing {host}. Hoping for JSON, prepared for HTML.',
    "Knocking on {host}'s door.",
    'Poking an endpoint. Gently.',
  ],
  'cmd.build': [
    'Building. Compilers are just very strict friends.',
    'Compiling. The type checker sees all.',
    "Build time. Let's see what the compiler thinks of us.",
  ],
  'cmd.lint': [
    'Linting. The linter is always right, just not always cheerful.',
    'Style check! Tabs or spaces? The config decides.',
    'Asking the linter for a second opinion.',
  ],

  // Results --------------------------------------------------------------------------------
  success: ['Done! Next.', 'That went well.', 'Smooth as a fresh deploy.', 'Nailed it.'],
  'success.tests': [
    'Tests green! Everybody act natural.',
    'All passing. Screenshot it before it changes its mind.',
    'Green across the board. Fireworks authorised!',
    "Green! I'd like to thank my tests, my linter and the Academy.",
    'The suite approves. Tiny victory dance.',
    'Passing tests: the best kind of quiet.',
  ],
  'success.install': [
    'Dependencies installed. node_modules is now visible from space.',
    'Packages acquired. The box pile grows.',
    'Installed. Somewhere, a hard drive sighed.',
  ],
  'success.commit': [
    'Committed! Future archaeologists will thank us.',
    'Into the history books it goes.',
    'Commit sealed. The message is actually descriptive.',
  ],
  'success.push': [
    "Pushed! It's in the cloud now. Someone else's computer, technically.",
    'Shipped! The mail truck is on its way.',
    'Pushed without force. Proud of us.',
    'Off it goes. Wave goodbye to the commits!',
  ],
  'success.build': [
    'Build succeeded. The compiler and I are friends again.',
    'Built clean. Not a single warning. Suspicious, but welcome.',
  ],
  fail: [
    "That didn't go to plan. New plan loading.",
    'Oops. Reading the error message, as the ancients advised.',
    'Error! Excellent, now we know something.',
    '{tool} hiccuped. Regrouping.',
    'Not quite. Back to the drawing board.',
  ],
  'fail.tests': [
    'Tests failed. On the bright side, the tests work.',
    'Red. The tests are trying to tell us something.',
    'A failing test is just a to-do list with attitude.',
    'It worked on my machine. I am the machine. Investigating.',
    'The tests said no. Time to find out why.',
    "Red is just green that hasn't happened yet.",
  ],
  'fail.notfound': [
    '{file} not found. It was here a minute ago, honest.',
    "File not found. It's playing hide and seek, and winning.",
    '404: file went for a walk.',
    'That path leads nowhere. Rerouting.',
  ],
  'fail.permission': [
    'Permission denied. The file has boundaries and I respect that.',
    'Access denied. Not even with a hard hat.',
    'Locked door. Looking for the right key, not a crowbar.',
  ],
  'fail.timeout': [
    'Timed out. Patience is a virtue; timeouts are a config value.',
    'That took too long. Even the coffee got cold.',
    'Still waiting… nope, timed out. Trying a smaller step.',
  ],
  'fail.interrupted': [
    'Interrupted! Changing course, captain.',
    'Stopped mid-sentence. Fair, I was rambling.',
    'Hands off the keyboard. Listening!',
  ],
  'fail.repeated': [
    '{n} failures in a row. A small personal rain cloud has formed.',
    'Again? The plot thickens. So does the cloud.',
    'Persistence is just debugging with extra steps.',
    'Failure number {n}. Each one teaches me something. Mostly humility.',
    'This bug is putting up a good fight.',
  ],

  // Permissions ----------------------------------------------------------------------------
  'permission.request': [
    'Requesting a permit for {cmd}. Safety first!',
    'This one needs a human signature.',
    "Paperwork for {tool}. I'll wait right here.",
    'Asking nicely before I touch anything important.',
  ],
  wait: ['Still waiting for that permit.', 'Waiting patiently. Mostly patiently.'],
  'wait.1': [
    'Waiting on a permit. Taking a number.',
    'Still at the Permit Office. Very orderly queue.',
    "Take your time! I'll practise my posture.",
  ],
  'wait.2': [
    "Still waiting. I've memorised all the forms.",
    "Just me and the ticket machine. We're bonding.",
    'Permit office update: the clock is ticking. Loudly.',
  ],
  'wait.3': [
    "I've befriended the stamp. Its name is Stampy.",
    "Waiting so long I've started reading the terms and conditions.",
    'Gentle reminder: someone in town needs your OK.',
  ],
  'wait.4': [
    "I've been here so long I'm eligible for a pension.",
    'The pigeons and I have a routine now.',
    'Hello? Is this thing on? One tiny permit, please.',
  ],
  'permission.allowed': [
    'Permit granted! Thank you, kind human.',
    'Approved! Stamped in triplicate.',
    'We have a green light!',
    'Approved. I promise to be careful with it.',
  ],
  'permission.denied': [
    'Denied. Fair! Plan B it is.',
    'No? Respect. Finding another way.',
    'Understood. Putting that idea back in the box.',
  ],
  'permission.expired': [
    "No answer here, so I'll ask in the terminal.",
    'The permit window closed. Taking the question to the terminal.',
  ],

  // Idle -----------------------------------------------------------------------------------
  'turn.done': [
    "All done! Take a look when you're ready.",
    'Finished. That felt good.',
    'Task complete. Celebrating responsibly.',
    'Done and dusted.',
    'Mission accomplished. Your move!',
  ],
  idle: [
    "Done for now. I'll be at the café.",
    'All quiet. Ping me when you need me.',
    'Coffee break, earned.',
    'Waiting for the next prompt. No pressure.',
  ],
  sleep: [
    'Zzz… dreaming of green builds.',
    'Power nap. Wake me for the next prompt.',
    "Zzz… merge conflicts can't find me here.",
    'Zzz… counting semicolons…',
  ],
  wake: ["I'm up! I'm up! What did I miss?", 'Back at it. Fully caffeinated.', 'Nap complete. Brain rebooted.'],

  // Context and models ---------------------------------------------------------------------
  'compact.start': [
    'Spa day for my context window.',
    'Compacting memories. Keeping the important bits.',
    'Context getting crowded. Time to tidy up.',
    'Summarising the story so far. Spoilers included.',
  ],
  'compact.end': [
    'Refreshed! I remember everything that matters.',
    'Context compacted. Feeling lighter already.',
    'Back from the spa. Glowing, focused, brief.',
  ],
  model: ['Model switch! Adjusting my hat.', 'Same crew, new brain: {model}.'],
  'model.opus': [
    'Opus mode: crown on, deep thoughts loading.',
    'Switching to {model}. Big brain, bigger hat.',
    'Crown on. Time for the thoughtful stuff.',
  ],
  'model.sonnet': [
    'Sonnet mode: fourteen lines of perfectly balanced code.',
    'Beret on. Quick, clever and stylish.',
    'Switching to {model}. Fast hands, steady head.',
  ],
  'model.haiku': [
    'Haiku mode. Small and fast. Like this line.',
    'Sun hat on. Light, breezy and quick.',
    'Switching to {model}: short words, quick wins.',
  ],
  'model.other': ['New model, new hat: {model}.', 'Switching to {model}. Same crew, new brain.', 'Model switch! Adjusting my hat.'],

  // Helpers --------------------------------------------------------------------------------
  spawn: ['{agent} has entered the chat.', '{agent} here, freshly summoned.', 'Reporting for duty!'],
  'spawn.explore': [
    "{agent} reporting! I'll scout the codebase and report back.",
    '{agent} here. Map, compass and magnifying glass packed.',
    'Scouting party of one. Back soon with findings!',
    '{agent} on recon. No file left unturned.',
  ],
  'spawn.plan': [
    '{agent} the Architect: blueprints first, bricks later.',
    "{agent} here. Let's draw this before we build it.",
    'Planning mode: measuring the whole house before touching a wall.',
  ],
  'spawn.general': [
    '{agent} at your service. General-purpose, specifically.',
    '{agent} reporting for duty. Point me at the problem.',
    '{agent} here. Hands ready, hard hat on.',
    'General-purpose helper, ready for anything.',
  ],
  'spawn.teammate': [
    "{agent} joining the team! Where's the stand-up?",
    'Hi team, {agent} here. Happy to help!',
    '{agent} clocking in. Teamwork makes the dream work.',
    'New teammate reporting! Where do I sit?',
  ],
  'spawn.other': ['{agent} has entered the chat.', 'Specialist {agent} reporting: {type} is my thing.', 'Freshly summoned and ready to help!'],
  'subagent.done': [
    "{agent} out. The report's on your desk.",
    'Mission complete. Back through the portal!',
    'Job done. It was a pleasure, team.',
    '{agent} signing off. Good luck, Foreman!',
  ],

  // Turn failures --------------------------------------------------------------------------
  stop: ['Storm warning! Something went wrong upstream.', 'Taking cover under this cloud for a moment.'],
  'stop.rate_limit': [
    'Rate limited. Even AIs need a breather.',
    'Too many requests! Taking the scenic route.',
    "Speed bump. We'll be back on the road shortly.",
  ],
  'stop.overloaded': [
    'Servers are busy. Everyone wants to build towns today.',
    'Overloaded upstream. Waiting for a quieter moment.',
  ],
  'stop.other': [
    'Something went wrong upstream ({error}). Regrouping.',
    'Stopped by {error}. Taking cover under this cloud.',
    'Storm warning! Upstream trouble.',
  ],

  // Board, messages, worktrees, harbor, achievements ----------------------------------------
  'todo.done': ['Ticked one off. Small wins count.', 'One more down!', 'Checkmark acquired.', 'Progress! The board is looking greener.'],
  'todos.all': ['Every todo done! Clean sweep!', 'The whole list, done. Somebody frame this board.', 'All boxes ticked. Very satisfying.'],
  'task.done': ['Task complete! Moving it to the done pile.', 'Another task off the board.', 'Done! The board is looking tidier.'],
  'message.send': [
    'Note for {to}, express delivery.',
    'Paper plane to {to}!',
    'Sending {to} a quick question.',
    'Letter for {to}. First class.',
    'Paper plane, away!',
  ],
  'message.receive': ['Mail for me? How exciting!', 'Got your message! On it.'],
  worktree: [
    'Planted a worktree: {name}. Branching out!',
    'New worktree {name}: a safe garden for experiments.',
    'A fresh worktree. Isolation never looked so green.',
  ],
  'mcp.boat': ['Boat from {server} spotted on the horizon!', 'Ship ahoy! {server} is delivering.', 'Cargo arriving at the harbor!'],
  achievement: [
    'Achievement unlocked: {title}!',
    '{title}! Somebody get the confetti.',
    'New badge: {title}. Very shiny.',
    'Achievement unlocked! Somebody get the confetti.',
  ],
  'notify.attention': ['Hey! Over here! I need your input.', 'A quick question needs your attention.', 'Waving politely. Got a minute?'],
});

/** Every situation that has lines of its own. Unknown situations fall back to their parent. */
export const SITUATIONS = Object.freeze(Object.keys(LINES));

const PLACEHOLDER = /\{(\w+)\}/g;
const MAX_VALUE_LENGTH = 48;

/** @param {string} line */
function placeholdersOf(line) {
  return [...line.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** Lines pre-parsed once: which placeholders each needs. */
const PARSED = new Map(SITUATIONS.map((s) => [s, LINES[s].map((line) => ({ line, needs: placeholdersOf(line) }))]));

/**
 * "fail.timeout" → itself; "fail.weird" → "fail"; "nonsense" → "generic".
 * @param {string} situation
 */
function resolveSituation(situation) {
  let key = typeof situation === 'string' ? situation : '';
  while (key) {
    if (PARSED.has(key)) return key;
    const dot = key.lastIndexOf('.');
    key = dot > 0 ? key.slice(0, dot) : '';
  }
  return 'generic';
}

/**
 * Context values usable in a line: non-empty, one line, short. Anything else counts as missing.
 * @param {Record<string, unknown>|undefined} context
 * @returns {Map<string, string>}
 */
function usableValues(context) {
  const values = new Map();
  if (!context || typeof context !== 'object') return values;
  for (const [key, raw] of Object.entries(context)) {
    let text = '';
    if (typeof raw === 'number' && Number.isFinite(raw)) text = String(raw);
    else if (typeof raw === 'string') text = clip(oneLine(raw), MAX_VALUE_LENGTH);
    if (text && text !== 'undefined' && text !== 'null') values.set(key, text);
  }
  return values;
}

/** @param {() => number} random @param {number} n */
function pickIndex(random, n) {
  const r = Number(random());
  const unit = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0;
  return Math.floor(unit * n);
}

/**
 * @param {{memory?: number}} [options]  memory: how many recent lines per situation to avoid
 */
export function createHumor(options = {}) {
  const memory = Number.isInteger(options.memory) ? Math.max(0, options.memory) : 6;
  /** @type {Map<string, number[]>} */
  const recent = new Map();

  /**
   * A line for a situation, filled with details from `context`.
   * @param {string} situation  e.g. "arrive.library", "fail.tests", "spawn.explore"
   * @param {Record<string, unknown>} [context]  e.g. {file, cmd, pattern, host, n, agent, project, model}
   * @param {() => number} [random]
   * @returns {string}
   */
  function quip(situation, context = {}, random = Math.random) {
    const key = resolveSituation(situation);
    const values = usableValues(context);
    const lines = PARSED.get(key) ?? PARSED.get('generic');
    let usable = lines.map((_, i) => i).filter((i) => lines[i].needs.every((name) => values.has(name)));
    if (!usable.length) return quip('generic', {}, random);
    const seen = recent.get(key) ?? [];
    const window = Math.min(memory, usable.length - 1);
    const fresh = usable.filter((i) => !seen.slice(-window).includes(i));
    if (window > 0 && fresh.length) usable = fresh;
    const index = usable[pickIndex(random, usable.length)];
    recent.set(key, [...seen, index].slice(-Math.max(memory, 1)));
    return lines[index].line.replace(PLACEHOLDER, (_, name) => values.get(name) ?? '');
  }

  return { quip };
}

const shared = createHumor();

/**
 * A line for a situation, filled with details from `context` (CONTRACTS.md §5). Shares one
 * repeat-avoidance memory per page; use createHumor() for an independent one.
 * @param {string} situation
 * @param {Record<string, unknown>} [context]
 * @param {() => number} [random]
 * @returns {string}
 */
export function quip(situation, context = {}, random = Math.random) {
  return shared.quip(situation, context, random);
}
