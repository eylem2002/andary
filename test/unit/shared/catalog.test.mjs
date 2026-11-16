import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDINGS, BUILDING_KEYS, TOOL_BUILDING, BUILDING_ACTIVITY, CREW_COLORS,
  buildingForTool, activityForTool, hatForModel,
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
  assert.equal(hatForModel('gpt-x'), null);
  assert.equal(hatForModel(undefined), null);
});

test('crew colours are distinct hex colours', () => {
  assert.equal(new Set(CREW_COLORS).size, CREW_COLORS.length);
  for (const c of CREW_COLORS) assert.match(c, /^#[0-9A-F]{6}$/i);
});
