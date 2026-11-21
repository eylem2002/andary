// Permission rules that Claude Code proposes with a permission request (`permission_suggestions`,
// CONTRACTS §4.5), and how the town writes them. The server decides with these rules what an
// approval may offer to save, and the demo, which plays the server's part, decides the same way;
// the store and the HUD write the rules the same way. The town only offers an allow rule kept for
// this project and only you (`localSettings`) or until the session ends (`session`): never one
// that changes other people's prompts (`projectSettings`, `userSettings`), a permission mode or
// working folders, and only a rule the card can say exactly in words: one command, a command
// prefix, one web host or one MCP tool. Never a whole built-in tool, a wildcard, or a path rule
// (Claude Code reads those as gitignore patterns: `Edit(src)` covers every file under any src/).
// Pure and defensive: suggestions come from hook payloads and may be any shape.
// hooks/hook.mjs checks the same rules again on its own, since it must stand alone.
import { isObject, revealHidden } from './text.js';

/** Where a rule the town saves may go. */
const OFFERED_DESTINATIONS = Object.freeze(['localSettings', 'session']);
/** Every field of an `addRules` suggestion; a suggestion with any other field is not offered. */
const SUGGESTION_FIELDS = Object.freeze(['type', 'rules', 'behavior', 'destination']);
/** Tools whose rule content is a command line: a rule without a wildcard is one command. */
const COMMAND_TOOLS = Object.freeze(['Bash', 'PowerShell']);
/**
 * Tools whose command rule may also be a prefix (a trailing `:*` or ` *`). Not PowerShell: its
 * matching ignores letter case and expands aliases, so a prefix covers more than it reads.
 */
const PREFIX_TOOLS = Object.freeze(['Bash']);
/** A tool's name as Claude Code writes it: no spaces, parentheses or wildcards. */
const TOOL_NAME = /^[A-Za-z][\w-]*$/;
/** One tool of one MCP server: allowing it allows that tool only (a server alone means all its tools). */
const MCP_TOOL = /^mcp__[\w-]+__[\w-]+$/;
/** The two ways to write "commands starting with": `npm test:*` and `npm test *`. */
const COMMAND_PREFIX = /^([^*]+?)(?::\*| \*)$/;
/** A WebFetch rule for one host, with no wildcard: `domain:example.com`. */
const ONE_DOMAIN = /^domain:([A-Za-z0-9][A-Za-z0-9.-]*)$/;

/** @typedef {{ toolName: string, ruleContent?: string }} PermissionRule */
/** @typedef {'localSettings'|'session'} RuleDestination */
/** @typedef {{ kind: 'command' } | { kind: 'prefix', prefix: string } | { kind: 'domain', host: string } | { kind: 'tool' }} RuleReach */

/**
 * A suggestion the town may offer, with its place in the request's `permission_suggestions`: the
 * browser names that place to choose it.
 * @typedef {object} OfferedSuggestion
 * @property {number} index
 * @property {PermissionRule[]} rules
 * @property {RuleDestination} destination
 */

/**
 * A permission rule the way Claude Code describes one: a tool name and, if it covers less than
 * the whole tool, what it matches. A rule with any other field is refused: the card could not
 * show what that field means.
 * @param {unknown} rule
 * @returns {rule is PermissionRule}
 */
export function isPermissionRule(rule) {
  if (!isObject(rule) || typeof rule.toolName !== 'string' || rule.toolName === '') return false;
  return Object.keys(rule).every((key) => key === 'toolName' || (key === 'ruleContent' && typeof rule.ruleContent === 'string'));
}

/**
 * What a rule allows, when the card can say it exactly: one command (`command`, Bash and
 * PowerShell), commands starting with a prefix (`prefix`, Bash), fetches from one host
 * (`domain`, WebFetch), or every call of one MCP tool (`tool`). Null for anything else, which
 * would allow more than the card can say: a whole built-in tool (no content, an empty content,
 * which Claude Code saves as the bare tool, or `*`), any other wildcard (`rm -f *.log` also
 * allows `rm -f -r ~ x.log`), a path rule for a file tool (a gitignore pattern), an MCP rule with
 * content (Claude Code skips those), or a tool whose rules the town does not know.
 * @param {unknown} rule
 * @returns {RuleReach|null}
 */
export function ruleReach(rule) {
  if (!isPermissionRule(rule) || !TOOL_NAME.test(rule.toolName)) return null;
  const { toolName, ruleContent } = rule;
  if (ruleContent === undefined) return MCP_TOOL.test(toolName) ? { kind: 'tool' } : null;
  if (ruleContent.trim() === '') return null;
  if (toolName === 'WebFetch') {
    const host = ONE_DOMAIN.exec(ruleContent)?.[1];
    return host ? { kind: 'domain', host } : null;
  }
  if (!COMMAND_TOOLS.includes(toolName)) return null;
  if (!ruleContent.includes('*')) return { kind: 'command' };
  if (!PREFIX_TOOLS.includes(toolName)) return null;
  const prefix = COMMAND_PREFIX.exec(ruleContent)?.[1].trimEnd() ?? '';
  return prefix.trim() === '' ? null : { kind: 'prefix', prefix };
}

/**
 * Whether a destination is one the town may save a rule to.
 * @param {unknown} destination
 * @returns {destination is RuleDestination}
 */
export function isOfferedDestination(destination) {
  return OFFERED_DESTINATIONS.includes(/** @type {any} */ (destination));
}

/**
 * Whether the town may offer to save a suggestion: rules to allow (`addRules` with `allow`), at
 * least one, each allowing no more than it reads, for this project and only you or for this
 * session, and nothing else in it.
 * @param {unknown} suggestion
 * @returns {boolean}
 */
function isOfferable(suggestion) {
  if (!isObject(suggestion) || suggestion.type !== 'addRules' || suggestion.behavior !== 'allow') return false;
  if (!isOfferedDestination(suggestion.destination)) return false;
  const { rules } = suggestion;
  if (!Array.isArray(rules) || rules.length === 0 || !rules.every((rule) => ruleReach(rule) !== null)) return false;
  return Object.keys(suggestion).every((key) => SUGGESTION_FIELDS.includes(key));
}

/**
 * The suggestions of a permission request that the town may offer to save with an allow, each
 * with its place in the list and a copy of its rules.
 * @param {unknown} suggestions  the request's `permission_suggestions`
 * @returns {OfferedSuggestion[]}
 */
export function offerableSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.flatMap((suggestion, index) =>
    isOfferable(suggestion) ? [{ index, rules: suggestion.rules.map(copyRule), destination: suggestion.destination }] : [],
  );
}

/**
 * @param {PermissionRule} rule
 * @returns {PermissionRule}
 */
function copyRule({ toolName, ruleContent }) {
  return ruleContent === undefined ? { toolName } : { toolName, ruleContent };
}

/**
 * A rule's content escaped the way Claude Code writes it into settings (a backslash and each
 * parenthesis get a backslash), so `echo ), Bash(ls` cannot read as the end of one rule and the
 * start of another.
 * @param {string} content
 */
function escapeContent(content) {
  return content.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * A rule the way Claude Code's settings write it (`Bash(npm test:*)`, or `mcp__github__get_issue`
 * for a whole tool), with hidden characters revealed: people read it before it is saved. '' for
 * anything that is not a rule.
 * @param {unknown} rule
 * @returns {string}
 */
export function ruleText(rule) {
  if (!isPermissionRule(rule)) return '';
  const { toolName, ruleContent } = rule;
  return revealHidden(ruleContent ? `${toolName}(${escapeContent(ruleContent)})` : toolName);
}

/**
 * Several rules on one line: `Bash(npm test:*), Bash(npm run lint)`.
 * @param {unknown} rules
 * @returns {string}
 */
export function rulesText(rules) {
  return Array.isArray(rules) ? rules.map(ruleText).filter(Boolean).join(', ') : '';
}
