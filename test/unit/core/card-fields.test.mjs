// What an approval card shows of a request (core/card-fields.js): the town may hold a request only
// when the card shows every field of its input as it is.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CARD_FIELDS, cardLines, cardShowsAll } from '../../../public/js/core/card-fields.js';

describe('cardShowsAll', () => {
  test("a command's known options are on the card; anything else, like the sandbox override, is not", () => {
    for (const tool of ['Bash', 'PowerShell']) {
      assert.equal(cardShowsAll(tool, { command: 'npm test' }), true, tool);
      assert.equal(cardShowsAll(tool, { command: 'npm test', description: 'Run the tests', timeout: 60_000, run_in_background: false }), true, tool);
      assert.equal(cardShowsAll(tool, { command: 'npm test', dangerouslyDisableSandbox: true }), false, `${tool}: the card shows only $ command`);
      assert.equal(cardShowsAll(tool, { command: 'npm test', somethingNew: 1 }), false, `${tool}: an option nobody listed`);
    }
    assert.equal(cardShowsAll('Bash', { command: ['rm', 'a b'] }), true, "Codex's argument list is quoted word by word");
    assert.equal(cardShowsAll('Bash', { command: ['rm', { $: 'x' }] }), false);
    assert.equal(cardShowsAll('Bash', { command: { run: 'x' } }), false);
  });

  test('a file tool shows its path and its change, and nothing else', () => {
    assert.equal(cardShowsAll('Write', { file_path: 'a.ts', content: 'x' }), true);
    assert.equal(cardShowsAll('Write', { file_path: 'a.ts', content: { lines: ['x'] } }), false, 'a change the diff cannot show');
    assert.equal(cardShowsAll('Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b', replace_all: true }), true);
    assert.equal(cardShowsAll('Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b', replace_all: 'yes' }), false);
    assert.equal(cardShowsAll('MultiEdit', { file_path: 'a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd', replace_all: true }] }), true);
    assert.equal(cardShowsAll('MultiEdit', { file_path: 'a.ts', edits: [{ old_string: 'a', new_string: 'b', also: 'x' }] }), false, 'a field inside an edit the diff leaves out');
    assert.equal(cardShowsAll('MultiEdit', { file_path: 'a.ts', edits: [{ old_string: 'a' }] }), false, 'an edit the diff would drop');
    assert.equal(cardShowsAll('NotebookEdit', { notebook_path: 'n.ipynb', new_source: 'x', edit_mode: 'insert', cell_id: 'c1', cell_type: 'code' }), true);
    assert.equal(cardShowsAll('NotebookEdit', { notebook_path: 'n.ipynb', new_source: 'x', edit_mode: 'move' }), false);
    assert.equal(cardShowsAll('Edit', { file_path: 'a.ts', replace_all: true }), false, 'with no diff the card cannot say it replaces every occurrence');
    assert.equal(cardShowsAll('NotebookEdit', { notebook_path: 'n.ipynb', edit_mode: 'delete', cell_id: 'c1' }), false, 'with no new source the card says nothing of the cell');
    assert.equal(cardShowsAll('Write', { file_path: 'a.ts' }), true, 'a path alone is all there is to show');
  });

  test("the web tools' and Read's other options are lines on the card", () => {
    assert.equal(cardShowsAll('WebFetch', { url: 'https://x.dev', prompt: 'Summarize it' }), true);
    assert.equal(cardShowsAll('WebSearch', { query: 'x', allowed_domains: ['a.dev'], blocked_domains: [] }), true);
    assert.equal(cardShowsAll('Read', { file_path: '/etc/hosts', offset: 10, limit: 20 }), true);
    assert.equal(cardShowsAll('Read', { file_path: '/etc/hosts', follow: true }), false);
  });

  test('any other tool shows every field; an input that is not an object shows nothing', () => {
    assert.equal(cardShowsAll('mcp__deploy__run', { target: 'prod', force: true }), true);
    assert.equal(cardShowsAll('Frobnicate', {}), true);
    for (const input of ['rm -rf /', ['a'], null, undefined, 7]) assert.equal(cardShowsAll('mcp__deploy__run', input), false, String(input));
  });

  test('lines for the card', () => {
    assert.deepEqual(cardLines('Bash'), ['description', 'timeout', 'run_in_background']);
    assert.deepEqual(cardLines('mcp__deploy__run'), []);
    assert.deepEqual(cardLines('constructor'), [], 'an inherited name is no tool');
    assert.ok(Object.isFrozen(CARD_FIELDS));
  });
});
