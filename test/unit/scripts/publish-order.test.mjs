import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const script = readFileSync(`${root}scripts/publish-github.sh`, 'utf8');

/** The branches exactly as scripts/publish-github.sh reads them from docs/prs/ORDER.md. */
function branchesAsPublished() {
  const expression = /sed -n '([^']+)' docs\/prs\/ORDER\.md/.exec(script)?.[1];
  assert.ok(expression, 'the script reads ORDER.md with sed');
  return execFileSync('sed', ['-n', expression, 'docs/prs/ORDER.md'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
}

test('the publish script reads every branch in ORDER.md, even when a description has code marks', () => {
  const branches = branchesAsPublished();
  const listed = readFileSync(`${root}docs/prs/ORDER.md`, 'utf8').split('\n').filter((line) => line.startsWith('- `'));
  assert.equal(branches.length, listed.length);
  for (const branch of branches) assert.match(branch, /^[a-z]+\/[a-z0-9-]+$/, branch);
});

test('every pull request description exists, is numbered in order and targets the branch before it', () => {
  const branches = branchesAsPublished();
  branches.forEach((branch, index) => {
    const file = `${root}docs/prs/${String(index + 1).padStart(2, '0')}-${branch.replaceAll('/', '-')}.md`;
    assert.ok(existsSync(file), file);
    const header = readFileSync(file, 'utf8').split('\n')[2];
    const base = index === 0 ? 'main' : branches[index - 1];
    assert.ok(header.startsWith(`Part ${index + 1} of ${branches.length} · base: \`${base}\``), `${file}: ${header}`);
    assert.equal(header.endsWith(' · merge last'), index === branches.length - 1, `${file}: only the last part says merge last`);
  });
});
