// Shared vocabulary for every layer: the town's buildings, which Claude Code tools send an agent
// to which building, and the animation an agent plays while a tool runs there.
// Both the 3D world and the HUD import this file, so a new tool only needs to be mapped here.

/** @typedef {'hall'|'library'|'workshop'|'terminal'|'detective'|'web'|'board'|'post'|'harbor'|'permits'|'spa'|'academy'|'cafe'|'grove'|'station'} BuildingKey */
/** @typedef {'idle'|'walk'|'run'|'read'|'type'|'hammer'|'search'|'think'|'wait'|'celebrate'|'facepalm'|'sleep'|'sip'|'carry'|'wave'|'spa'|'write'} Activity */

/**
 * @typedef {object} BuildingInfo
 * @property {BuildingKey} key
 * @property {string} name   Display name on signs and in the HUD.
 * @property {string} icon   Emoji used on the in-world sign.
 * @property {string} blurb  One-line explanation shown on hover.
 */

/** @type {Readonly<Record<BuildingKey, BuildingInfo>>} */
export const BUILDINGS = Object.freeze({
  hall: { key: 'hall', name: 'Town Hall', icon: '🏛️', blurb: 'Crews start here and new agents are spawned here.' },
  library: { key: 'library', name: 'Library', icon: '📚', blurb: 'Agents come here to read files.' },
  workshop: { key: 'workshop', name: 'Workshop', icon: '🔨', blurb: 'Agents come here to edit and write files.' },
  terminal: { key: 'terminal', name: 'Terminal Works', icon: '🏭', blurb: 'Agents come here to run shell commands.' },
  detective: { key: 'detective', name: 'Search Bureau', icon: '🔍', blurb: 'Agents come here to grep and glob through code.' },
  web: { key: 'web', name: 'Web Tower', icon: '📡', blurb: 'Agents come here to search and fetch the web.' },
  board: { key: 'board', name: 'Goal Board', icon: '📋', blurb: 'Todo lists and shared team tasks are pinned here.' },
  post: { key: 'post', name: 'Post Office', icon: '📮', blurb: 'Messages between agents, git commits and pushes.' },
  harbor: { key: 'harbor', name: 'MCP Harbor', icon: '⚓', blurb: 'Tools from MCP servers arrive by boat.' },
  permits: { key: 'permits', name: 'Permit Office', icon: '🛂', blurb: 'Agents wait here for your approval.' },
  spa: { key: 'spa', name: 'Memory Spa', icon: '♨️', blurb: 'Agents relax here while their context is compacted.' },
  academy: { key: 'academy', name: 'Skill Academy', icon: '🎓', blurb: 'Agents load skills and slash commands here.' },
  cafe: { key: 'cafe', name: 'Café', icon: '☕', blurb: 'Idle agents wait here for your next prompt.' },
  grove: { key: 'grove', name: 'Worktree Grove', icon: '🌳', blurb: 'Every git worktree grows a tree here.' },
  station: { key: 'station', name: 'Bus Stop', icon: '🚏', blurb: 'Sessions arrive and leave by bus.' },
});

/** @type {BuildingKey[]} */
export const BUILDING_KEYS = /** @type {BuildingKey[]} */ (Object.keys(BUILDINGS));

/** @type {Readonly<Record<string, BuildingKey>>} */
export const TOOL_BUILDING = Object.freeze({
  Read: 'library',
  NotebookRead: 'library',
  Edit: 'workshop',
  MultiEdit: 'workshop',
  Write: 'workshop',
  NotebookEdit: 'workshop',
  Bash: 'terminal',
  BashOutput: 'terminal',
  KillShell: 'terminal',
  KillBash: 'terminal',
  PowerShell: 'terminal',
  Monitor: 'terminal',
  Grep: 'detective',
  Glob: 'detective',
  LS: 'detective',
  LSP: 'detective',
  ToolSearch: 'detective',
  WebFetch: 'web',
  WebSearch: 'web',
  TodoWrite: 'board',
  TaskCreate: 'board',
  TaskUpdate: 'board',
  TaskList: 'board',
  TaskGet: 'board',
  TaskStop: 'board',
  TaskOutput: 'board',
  EnterPlanMode: 'board',
  ExitPlanMode: 'board',
  SendMessage: 'post',
  AskUserQuestion: 'permits',
  Skill: 'academy',
  SlashCommand: 'academy',
  EnterWorktree: 'grove',
  ExitWorktree: 'grove',
  Agent: 'hall',
  Task: 'hall',
  // Codex tools the server's adapter leaves as they are (a deleted file, an unread patch).
  apply_patch: 'workshop',
  spawn_agent: 'hall',
});

/** @type {Readonly<Record<BuildingKey, Activity>>} */
export const BUILDING_ACTIVITY = Object.freeze({
  hall: 'think',
  library: 'read',
  workshop: 'hammer',
  terminal: 'type',
  detective: 'search',
  web: 'type',
  board: 'write',
  post: 'carry',
  harbor: 'carry',
  permits: 'wait',
  spa: 'spa',
  academy: 'read',
  cafe: 'sip',
  grove: 'think',
  station: 'wave',
});

const GIT_SHIPPING = /^\s*(?:\S+=\S+\s+)*git\s+(?:commit|push|tag)\b/;
const WEB_CLIENTS = /^\s*(?:curl|wget|http|https|xh)\b/;

/**
 * Picks the building an agent walks to for a tool call.
 * @param {string} toolName
 * @param {any} [input] the tool_input from the hook payload
 * @returns {BuildingKey}
 */
export function buildingForTool(toolName, input) {
  if (!toolName) return 'hall';
  if (toolName.startsWith('mcp__')) return 'harbor';
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = typeof input?.command === 'string' ? input.command : '';
    if (GIT_SHIPPING.test(command)) return 'post';
    if (WEB_CLIENTS.test(command)) return 'web';
  }
  // hasOwn: a tool literally named "constructor" must not resolve to Object.prototype.
  return Object.hasOwn(TOOL_BUILDING, toolName) ? TOOL_BUILDING[toolName] : 'workshop';
}

/**
 * Picks the animation for a tool call; Write types where Edit hammers.
 * @param {string} toolName
 * @param {BuildingKey} building
 * @returns {Activity}
 */
export function activityForTool(toolName, building) {
  if (toolName === 'Write' || toolName === 'NotebookEdit') return 'type';
  if (toolName === 'TodoWrite' || toolName === 'TaskCreate' || toolName === 'TaskUpdate') return 'write';
  return Object.hasOwn(BUILDING_ACTIVITY, building) ? BUILDING_ACTIVITY[building] : 'think';
}

/** Crew (session) colors: distinct hues that keep white label text at WCAG AA contrast. */
export const CREW_COLORS = Object.freeze([
  '#2457D6', // cobalt
  '#B4235A', // raspberry
  '#0F7A5C', // pine
  '#8A4FD8', // violet
  '#B85C00', // copper
  '#0B6E99', // lagoon
  '#A13A2C', // brick
  '#4B5E1F', // olive
]);

/** Hats signal the model a session runs on; unknown models keep the role hat. */
const MODEL_HATS = Object.freeze({ opus: 'crown', sonnet: 'beret', haiku: 'sunhat', fable: 'wizard', mythos: 'wizard' });
/** OpenAI models (a Codex crew): "gpt-5.3-codex", "o4-mini". */
const OPENAI_MODEL = /^(gpt-|o\d)/i;

/**
 * Human model name: "claude-opus-5-5" → "Opus 5.5", "claude-3-5-sonnet-20241022" → "Sonnet 3.5".
 * The version may come after the family (current ids) or before it (older ids), and a trailing
 * date stamp is never read as a version. Unknown ids are returned as they are, clipped.
 * @param {unknown} modelId
 * @returns {string}
 */
export function modelLabel(modelId) {
  if (modelId == null || modelId === '') return '';
  const raw = String(modelId).trim();
  const id = raw.toLowerCase();
  // "gpt-5.3-codex" → "GPT-5.3 Codex", "gpt-5-codex-mini" → "GPT-5 Codex Mini"
  if (id.startsWith('gpt-')) {
    const [version, ...words] = raw.slice(4).split('-');
    return clipLabel([`GPT-${version}`, ...words.filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1))].join(' '));
  }
  const family = Object.keys(MODEL_HATS).find((name) => id.includes(name));
  if (!family) return clipLabel(raw);
  const name = family[0].toUpperCase() + family.slice(1);
  const after = id.match(new RegExp(`${family}-(\\d{1,2})(?:[-.](\\d{1,2}))?(?!\\d)`));
  const before = id.match(new RegExp(`(\\d)-(\\d)-${family}`));
  const version = (after ? [after[1], after[2]] : before ? [before[1], before[2]] : []).filter(Boolean).join('.');
  return version ? `${name} ${version}` : name;
}

/** @param {string} label */
function clipLabel(label) {
  return label.length > 24 ? `${label.slice(0, 23)}…` : label;
}

/**
 * @param {string} [modelId] e.g. "claude-opus-5-5"
 * @returns {string|null}
 */
export function hatForModel(modelId) {
  if (!modelId) return null;
  if (OPENAI_MODEL.test(modelId)) return 'cap';
  const id = modelId.toLowerCase();
  for (const [family, hat] of Object.entries(MODEL_HATS)) {
    if (id.includes(family)) return hat;
  }
  return null;
}
