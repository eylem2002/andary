// Shared inputs for the source adapter tests: a Codex patch touching four files, and a Codex hook
// payload as its hooks send them.

export const PATCH = [
  '*** Begin Patch',
  '*** Add File: src/new.ts',
  '+export const a = 1;',
  '+export const b = 2;',
  '*** Update File: src/app.ts',
  '@@ function main()',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '@@',
  '-old()',
  '+renewed()',
  '*** Update File: src/old-name.ts',
  '*** Move to: src/new-name.ts',
  '@@',
  '-a',
  '+b',
  '*** Delete File: src/gone.ts',
  '*** End Patch',
].join('\n');

/**
 * A Codex hook payload.
 * @param {string} event
 * @param {Record<string, any>} [extra]
 */
export const codex = (event, extra = {}) => ({
  session_id: 'thr_123',
  transcript_path: '/home/dev/.codex/sessions/2026/11/20/rollout-1.jsonl',
  cwd: '/home/dev/code/app',
  hook_event_name: event,
  model: 'gpt-5.3-codex',
  permission_mode: 'default',
  turn_id: 'turn_1',
  ...extra,
});
