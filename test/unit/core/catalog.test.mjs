import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDINGS, BUILDING_KEYS, TOOL_BUILDING, BUILDING_ACTIVITY, CREW_COLORS,
  buildingForTool, activityForTool, hatForModel, modelLabel,
} from '../../../public/js/core/catalog.js';

test('every tool maps to a real building and every building has an activity', () => {
  for (const [tool, key] of Object.entries(TOOL_BUILDING)) assert.ok(BUILDINGS[key], `${tool} → ${key}`);
  for (const key of BUILDING_KEYS) assert.ok(BUILDING_ACTIVITY[key], key);
});

test('MCP tools go to the harbor; unknown tools to the workshop; empty names to the hall', () => {
  assert.equal(buildingForTool('mcp__github__create_issue'), 'harbor');
  assert.equal(buildingForTool('SomeFutureTool'), 'workshop');
  assert.equal(buildingForTool(''), 'hall');
});

test('prototype property names never resolve to inherited members', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(buildingForTool(name), 'workshop', name);
    assert.equal(activityForTool('Read', /** @type {any} */ (name)), 'think', name);
  }
});

test('shell commands that ship code go to the post office, web clients to the web tower', () => {
  assert.equal(buildingForTool('Bash', { command: 'git commit -m "fix"' }), 'post');
  assert.equal(buildingForTool('Bash', { command: 'GIT_TRACE=1 git push origin main' }), 'post');
  assert.equal(buildingForTool('Bash', { command: 'curl -s https://example.com' }), 'web');
  assert.equal(buildingForTool('Bash', { command: 'npm test' }), 'terminal');
  assert.equal(buildingForTool('Bash', { command: 42 }), 'terminal');
});

test('write-like tools type, task tools write, the rest follow their building', () => {
  assert.equal(activityForTool('Write', 'workshop'), 'type');
  assert.equal(activityForTool('Edit', 'workshop'), 'hammer');
  assert.equal(activityForTool('TaskCreate', 'board'), 'write');
  assert.equal(activityForTool('Read', 'library'), 'read');
});

test('model ids map to hats by family', () => {
  assert.equal(hatForModel('claude-opus-5-5'), 'crown');
  assert.equal(hatForModel('claude-sonnet-5-5'), 'beret');
  assert.equal(hatForModel('claude-haiku-5-5'), 'sunhat');
  assert.equal(hatForModel('claude-fable-5-2'), 'wizard');
  assert.equal(hatForModel('mistral-large'), null, 'unknown vendors keep the role hat');
  assert.equal(hatForModel(undefined), null);
});

test('crew colours are distinct hex colours', () => {
  assert.equal(new Set(CREW_COLORS).size, CREW_COLORS.length);
  for (const c of CREW_COLORS) assert.match(c, /^#[0-9A-F]{6}$/i);
});

test('model labels read the version on either side of the family, never a date stamp', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(modelLabel('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelLabel('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
  assert.equal(modelLabel('claude-haiku-5'), 'Haiku 5');
  assert.equal(modelLabel('claude-fable-5-2'), 'Fable 5.2');
  assert.equal(modelLabel('sonnet'), 'Sonnet');
  // OpenAI models, from a Codex crew.
  assert.equal(modelLabel('gpt-5.3-codex'), 'GPT-5.3 Codex');
  assert.equal(modelLabel('gpt-5-codex-mini'), 'GPT-5 Codex Mini');
  assert.equal(modelLabel('o4-mini'), 'o4-mini');
  assert.equal(hatForModel('gpt-5.3-codex'), 'cap');
  assert.equal(hatForModel('o3'), 'cap');
  assert.equal(buildingForTool('apply_patch', {}), 'workshop');
  assert.equal(modelLabel('a-very-long-model-name-from-another-vendor'), 'a-very-long-model-name-…');
  assert.equal(modelLabel(undefined), '');
});
