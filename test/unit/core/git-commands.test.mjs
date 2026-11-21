// Git commands that put other agents' uncommitted work at risk (core/git-commands.js): each one it
// recognises, the ones it must leave alone, and command lines read as a shell reads them (chains,
// cd, quotes, redirections, here-documents), so a commit message that mentions a command is not
// that command.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { gitHazardOf, shellCommands } from '../../../public/js/core/git-commands.js';

const CWD = '/home/dev/code/api-server';

/** @param {unknown} command @param {unknown} [folder] @param {{ powershell?: boolean }} [options] */
const hazard = (command, folder = CWD, options = {}) => gitHazardOf(command, folder, options);

describe('gitHazardOf: the commands it recognises', () => {
  /** @type {[string, string][]} the command line, and how it is named */
  const RECOGNISED = [
    ['git add -A && git commit -m "Save the work"', 'git add -A && git commit'],
    ['git add . && git commit -m "Save the work"', 'git add . && git commit'],
    ['git add --all; git commit -m wip', 'git add --all && git commit'],
    ['git add -u && git commit --amend --no-edit', 'git add -u && git commit'],
    ['git add --update && git commit -q -m x', 'git add --update && git commit'],
    ['git add :/ && git commit -m x', 'git add :/ && git commit'],
    ['git commit -a -m "Save"', 'git commit -a'],
    ['git commit -am "Save"', 'git commit -a'],
    ['git commit --all --message=wip', 'git commit -a'],
    ['git stash', 'git stash'],
    ['git stash push -m "before the rebase"', 'git stash'],
    ['git stash save wip', 'git stash'],
    ['git stash -u', 'git stash'],
    ['git stash -m "keep -a safe"', 'git stash'],
    ['git stash -- src/auth.ts', 'git stash'],
    ['git checkout .', 'git checkout .'],
    ['git checkout -- src/auth.ts', 'git checkout -- src/auth.ts'],
    ['git checkout HEAD~1 -- src/auth.ts', 'git checkout -- src/auth.ts'],
    ['git checkout -f main', 'git checkout -f'],
    ['git switch --discard-changes main', 'git switch --discard-changes'],
    ['git switch -f main', 'git switch --discard-changes'],
    ['git restore src/auth.ts', 'git restore src/auth.ts'],
    ['git restore --source=HEAD~1 .', 'git restore .'],
    ['git restore -s HEAD~1 src/auth.ts', 'git restore src/auth.ts'],
    ['git restore --staged --worktree src/auth.ts', 'git restore src/auth.ts'],
    ['git reset --hard', 'git reset --hard'],
    ['git reset --hard origin/main', 'git reset --hard'],
    ['git clean -f', 'git clean -f'],
    ['git clean -fd', 'git clean -fd'],
    ['git clean -xdf', 'git clean -fdx'],
    ['git clean --force -d -e "*.log"', 'git clean -fd'],
  ];
  for (const [command, words] of RECOGNISED) {
    test(command, () => assert.deepEqual(hazard(command), { command: words, folder: CWD }));
  }
});

describe('gitHazardOf: what it leaves alone', () => {
  const HARMLESS = [
    'git status',
    'git status --short && git diff --stat',
    'git log --oneline -20',
    'git diff',
    'git diff HEAD~1 -- src/auth.ts',
    'git show HEAD',
    'git add file.js',
    'git add src/auth.ts && git commit -m "Fix auth"',
    'git add -A',
    'git add -A src/ && git commit -m "Only src"',
    'git add -n . && git commit -m "A dry run first"',
    'git commit -m "Save"',
    'git commit -m "-a is a message here"',
    'git commit -ma',
    'git commit -a --dry-run',
    'git stash list',
    'git stash show -p stash@{0}',
    'git stash pop',
    'git stash apply stash@{1}',
    'git stash drop',
    'git checkout main',
    'git checkout -b feature/login origin/main',
    'git checkout -',
    'git switch main',
    'git switch -c feature/login',
    'git restore --staged src/auth.ts',
    'git reset',
    'git reset --soft HEAD~1',
    'git reset HEAD -- src/auth.ts',
    'git clean -n',
    'git clean -fn',
    'git clean -f --dry-run',
    'git push -u origin main',
    'git pull --rebase',
    'git branch -D old-idea',
    'echo "git stash"',
    'grep -rn "git reset --hard" docs',
    'npm test',
    '',
  ];
  for (const command of HARMLESS) test(command || '(an empty line)', () => assert.equal(hazard(command), null));
});

describe('gitHazardOf: a line of several commands', () => {
  test('chains: &&, ||, ;, |, & and new lines', () => {
    for (const command of ['npm test && git stash', 'npm test || git stash', 'npm test; git stash', 'git status | cat; git stash', 'sleep 1 & git stash', 'npm test\ngit stash', '{ npm test; git stash; }']) {
      assert.equal(hazard(command)?.command, 'git stash', command);
    }
  });

  test('cd moves the folder for what follows, relative or absolute', () => {
    assert.deepEqual(hazard('cd packages/web && git stash'), { command: 'git stash', folder: `${CWD}/packages/web` });
    assert.deepEqual(hazard('cd .. && git reset --hard'), { command: 'git reset --hard', folder: '/home/dev/code' });
    assert.deepEqual(hazard('cd "/home/dev/code/other repo" && git clean -fd'), { command: 'git clean -fd', folder: '/home/dev/code/other repo' });
    assert.deepEqual(hazard('(cd packages/web && git stash)'), { command: 'git stash', folder: `${CWD}/packages/web` });
    assert.deepEqual(hazard('pushd packages/web && git checkout . && popd'), { command: 'git checkout .', folder: `${CWD}/packages/web` });
  });

  test('git -C names the folder, and options before the subcommand are skipped', () => {
    assert.deepEqual(hazard('git -C ../billing stash'), { command: 'git stash', folder: '/home/dev/code/billing' });
    assert.deepEqual(hazard('git -C /srv/app -c core.pager=cat --no-pager reset --hard'), { command: 'git reset --hard', folder: '/srv/app' });
  });

  test('a folder it cannot tell (home, the last one, a variable) leaves what follows unjudged', () => {
    for (const command of ['cd ~ && git stash', 'cd ~/code/api && git stash', 'cd - && git stash', 'cd "$REPO" && git stash', 'cd && git stash', 'git -C "$REPO" stash']) {
      assert.equal(hazard(command), null, command);
    }
    assert.equal(hazard('git stash', ''), null, 'no folder at all');
    assert.deepEqual(hazard('cd ~ && cd /srv/app && git stash'), { command: 'git stash', folder: '/srv/app' }, 'an absolute cd places it again');
  });

  test('the add and its commit may be apart on the line; the first hazard counts', () => {
    assert.equal(hazard('git add . && npm run lint && git commit -m "Lint"')?.command, 'git add . && git commit');
    assert.equal(hazard('git stash && git checkout main && git stash pop')?.command, 'git stash');
    assert.equal(hazard('git commit -m x && git add -A')?.command, undefined, 'staged after the commit: nothing committed');
  });

  test('inside if and loops, behind sudo, env or time', () => {
    assert.equal(hazard('if ! git diff --quiet; then git stash; fi')?.command, 'git stash');
    assert.equal(hazard('for f in src/*.ts; do git checkout -- "$f"; done')?.command, 'git checkout -- $f');
    assert.equal(hazard('sudo git reset --hard')?.command, 'git reset --hard');
    assert.equal(hazard('env GIT_EDITOR=true git commit -a')?.command, 'git commit -a');
    assert.equal(hazard('time git clean -fd')?.command, 'git clean -fd');
    assert.equal(hazard('if git diff --quiet; then echo clean; fi'), null);
  });

  test('variables before a command, a path to git, quoted paths', () => {
    assert.equal(hazard('GIT_EDITOR=true git commit -a')?.command, 'git commit -a');
    assert.equal(hazard('/usr/bin/git stash')?.command, 'git stash');
    assert.equal(hazard("git checkout -- 'src/a file.ts'")?.command, 'git checkout -- src/a file.ts');
    assert.equal(hazard(`git checkout -- ${'very/long/path/'.repeat(10)}a.ts`)?.command.length, 60, 'a long path is cut');
  });

  test('PowerShell: backslashes are paths, and Set-Location moves', () => {
    assert.deepEqual(hazard('Set-Location C:\\work\\api; git stash', 'C:\\Users\\dev', { powershell: true }), { command: 'git stash', folder: 'C:/work/api' });
    assert.deepEqual(hazard('cd C:\\work\\api; git reset --hard', 'C:\\x', { powershell: true }), { command: 'git reset --hard', folder: 'C:/work/api' });
  });

  test("a Codex argument list reads like the line it stands for", () => {
    assert.deepEqual(hazard(['git', 'stash']), { command: 'git stash', folder: CWD });
    assert.equal(hazard(['git', 'stash', 'list']), null);
  });
});

describe('shellCommands: a line read as a shell reads it', () => {
  test('words, quotes and escapes', () => {
    assert.deepEqual(shellCommands('git commit -m "Fix the \\"login\\" bug" --author=\'A B\' a\\ b'), [['git', 'commit', '-m', 'Fix the "login" bug', '--author=A B', 'a b']]);
    assert.deepEqual(shellCommands('echo "C:\\temp" ""'), [['echo', 'C:\\temp', '']], 'in double quotes a backslash only escapes a few');
  });

  test('redirections and their targets are left out', () => {
    assert.deepEqual(shellCommands('git stash 2>&1 | tail -5'), [['git', 'stash'], ['tail', '-5']]);
    assert.deepEqual(shellCommands('npm test > out.log 2> err.log && git stash >/dev/null &>> all.log'), [['npm', 'test'], ['git', 'stash']]);
    assert.deepEqual(shellCommands('echo 2 > x.txt'), [['echo', '2']], 'a number before a space is an argument');
    assert.deepEqual(shellCommands('wc -l <<< "git stash"'), [['wc', '-l']]);
  });

  test('a commit message that mentions a command is not that command', () => {
    const line = 'git commit -m "$(cat <<\'EOF\'\nNever "git reset --hard"; it (really) can\'t be undone\nEOF\n)" && git push';
    assert.deepEqual(shellCommands(line).map((words) => words.slice(0, 2)), [['git', 'commit'], ['git', 'push']]);
    assert.equal(hazard(line), null);
    const nested = 'git commit -m "$(printf "Fix (issue 12) ) twice")" && git stash';
    assert.equal(hazard(nested)?.command, 'git stash', 'a ) in quotes inside $(…) does not end it');
  });

  test('here-document bodies and comments are no commands', () => {
    assert.deepEqual(shellCommands("cat > notes.md <<'EOF'\ngit stash\ngit reset --hard\nEOF\necho done"), [['cat'], ['echo', 'done']]);
    assert.deepEqual(shellCommands('cat <<-END\n\tgit clean -fd\n\tEND\nls'), [['cat'], ['ls']]);
    assert.deepEqual(shellCommands('echo hi # git stash\nls'), [['echo', 'hi'], ['ls']]);
    assert.deepEqual(shellCommands('echo a#b'), [['echo', 'a#b']], 'a # inside a word is no comment');
  });

  test('defensive: any input, never throws', () => {
    for (const input of [undefined, null, 42, {}, 'echo "unclosed', "echo 'unclosed", 'echo $(unclosed', 'a\\', `${'x'.repeat(100_000)} git stash`, '<<', '2>&', 'cat <<EOF\nno end']) {
      assert.doesNotThrow(() => shellCommands(input));
      assert.doesNotThrow(() => gitHazardOf(input, CWD));
    }
    assert.deepEqual(shellCommands({}), []);
    assert.deepEqual(shellCommands("echo 'unclosed"), [['echo', 'unclosed']]);
    assert.equal(hazard(`echo ${'x'.repeat(30_000)}; git stash`), null, 'past the length read, nothing is judged');
  });
});
