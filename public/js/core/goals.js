// A crew's goal is its latest meaningful prompt. "continue", "go on", "yes" and the like only
// keep the work going: they say nothing about what the work is, so the goal stays the one before
// (docs/ASSUMPTIONS.md 269). Pure, no DOM.

/** Longer prompts are always new instructions, whatever words they use. */
const MAX_FOLLOW_UP_CHARS = 48;
const MAX_FOLLOW_UP_WORDS = 6;

/**
 * Words that, on their own or together, only tell an agent to carry on ("ok go ahead",
 * "yes please continue", "try again", "lgtm"). A prompt made only of these is a follow-up.
 */
const FOLLOW_UP_WORDS = new Set([
  'continue', 'continuing', 'go', 'on', 'ahead', 'keep', 'going', 'carry', 'proceed', 'resume', 'next',
  'yes', 'y', 'yep', 'yeah', 'yup', 'ya', 'ok', 'okay', 'k', 'kk', 'sure', 'fine', 'alright', 'right',
  'please', 'pls', 'plz', 'thanks', 'thank', 'you', 'thx', 'ty',
  'do', 'it', 'that', 'so', 'then', 'and', 'now', 'again', 'retry', 'try', 'more',
  'lgtm', 'sounds', 'good', 'great', 'perfect', 'nice', 'cool', 'approved', 'approve', 'agreed',
]);

/**
 * True when a prompt only tells the agent to carry on, or picks a numbered option ("2"): it has
 * no task of its own to show as the crew's goal.
 * @param {string} prompt  one line, trimmed
 */
export function isFollowUp(prompt) {
  const text = String(prompt ?? '').trim().toLowerCase();
  if (!text || text.length > MAX_FOLLOW_UP_CHARS) return false;
  const words = text.replace(/[.,!?;:…'"`()[\]{}*_~-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (words.length > MAX_FOLLOW_UP_WORDS) return false;
  if (words.length === 1 && /^\d{1,2}$/.test(words[0])) return true;
  return words.every((word) => FOLLOW_UP_WORDS.has(word));
}

/**
 * The goal to show after a prompt: the prompt itself, unless it is a follow-up, which keeps the
 * goal before it (none yet: still none).
 * @param {string|undefined} previous
 * @param {string} prompt  one line, trimmed
 * @returns {string|undefined}
 */
export function nextGoal(previous, prompt) {
  if (!prompt) return previous;
  return isFollowUp(prompt) ? previous : prompt;
}
