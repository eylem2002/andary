// Git commands that put other agents' uncommitted work at risk (core/git-commands.js): each one it
// recognises with what it acts on, the ones it must leave alone, and command lines read as a shell
// reads them (chains, cd, quotes, redirections, here-documents, a shell's -c script), so a commit
// message that mentions a command is not that command.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { gitCommitsOf, gitHazardOf, shellCommands } from '../../../public/js/core/git-commands.js';

const CWD = '/home/dev/code/api-server';

/** @param {unknown} command @param {string} [folder] @param {{ powershell?: boolean, sessionFolder?: string }} [options] */
const hazard = (command, folder = CWD, options = {}) => gitHazardOf(command, { folder, sessionFolder: options.sessionFolder ?? folder }, options);
/** @param {string} rel */
const at = (rel) => `${CWD}/${rel}`;

describe('gitHazardOf: the commands it recognises, and what each acts on', () => {
  /** @type {[string, string, 'sweep'|'discard', string[]][]} the line, its words, its effect, its paths (none: the whole work tree) */
  const RECOGNISED = [
    ['git add -A && git commit -m "Save the work"', 'git add -A && git commit', 'sweep', []],
    ['git add . && git commit -m "Save the work"', 'git add . && git commit', 'sweep', [CWD]],
    ['git add --all; git commit -m wip', 'git add -A && git commit', 'sweep', []],
    ['git add -u && git commit --amend --no-edit', 'git add -u && git commit', 'sweep', []],
    ['git add :/ && git commit -m x', 'git add :/ && git commit', 'sweep', []],
    ['git add src/auth.ts lib && git commit -m "Fix auth"', 'git add src/auth.ts lib && git commit', 'sweep', [at('src/auth.ts'), at('lib')]],
    ['git commit -a -m "Save"', 'git commit -a', 'sweep', []],
    ['git commit -am "Save"', 'git commit -a', 'sweep', []],
    ['git commit --all --message=wip', 'git commit -a', 'sweep', []],
    ['git commit .', 'git commit .', 'sweep', [CWD]],
    ['git commit -m x src/', 'git commit src/', 'sweep', [at('src')]],
    ['git stash', 'git stash', 'discard', []],
    ['git stash push -m "before the rebase"', 'git stash', 'discard', []],
    ['git stash save wip', 'git stash', 'discard', []],
    ['git stash -u', 'git stash', 'discard', []],
    ['git stash -- src/auth.ts', 'git stash -- src/auth.ts', 'discard', [at('src/auth.ts')]],
    ['git stash push -m keep src/auth.ts', 'git stash -- src/auth.ts', 'discard', [at('src/auth.ts')]],
    ['git checkout .', 'git checkout .', 'discard', [CWD]],
    ['git checkout -- src/auth.ts', 'git checkout -- src/auth.ts', 'discard', [at('src/auth.ts')]],
    ['git checkout HEAD~1 -- src/*.ts', 'git checkout -- src/*.ts', 'discard', [at('src')]],
    ['git checkout -f main', 'git checkout -f', 'discard', []],
    ['git switch --discard-changes main', 'git switch --discard-changes', 'discard', []],
    ['git switch -f main', 'git switch --discard-changes', 'discard', []],
    ['git restore src/auth.ts', 'git restore src/auth.ts', 'discard', [at('src/auth.ts')]],
    ['git restore --source=HEAD~1 .', 'git restore .', 'discard', [CWD]],
    ['git restore -s HEAD~1 src/auth.ts', 'git restore src/auth.ts', 'discard', [at('src/auth.ts')]],
    ['git restore --staged --worktree src/auth.ts', 'git restore src/auth.ts', 'discard', [at('src/auth.ts')]],
    ['git reset --hard', 'git reset --hard', 'discard', []],
    ['git reset --hard origin/main', 'git reset --hard', 'discard', []],
    ['git clean -f', 'git clean -f', 'discard', [CWD]],
    ['git clean -xdf', 'git clean -fdx', 'discard', [CWD]],
    ['git clean --force -d -e "*.log" build', 'git clean -fd build', 'discard', [at('build')]],
  ];
  for (const [line, words, effect, paths] of RECOGNISED) {
    test(line, () => assert.deepEqual(hazard(line), { command: words, effect, folder: CWD, root: CWD, paths }));
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
    'git add -A',
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
    'bash scripts/release.sh',
    'npm test',
    '',
  ];
  for (const line of HARMLESS) test(line || '(an empty line)', () => assert.equal(hazard(line), null));
});

describe('gitHazardOf: a line of several commands', () => {
  test('chains: &&, ||, ;, |, & and new lines', () => {
    for (const line of ['npm test && git stash', 'npm test || git stash', 'npm test; git stash', 'git status | cat; git stash', 'sleep 1 & git stash', 'npm test\ngit stash', '{ npm test; git stash; }']) {
      assert.equal(hazard(line)?.command, 'git stash', line);
    }
  });

  test('cd moves the folder for what follows, relative or absolute', () => {
    assert.equal(hazard('cd packages/web && git stash')?.folder, at('packages/web'));
    assert.equal(hazard('cd .. && git reset --hard')?.folder, '/home/dev/code');
    assert.equal(hazard('cd "/home/dev/code/other repo" && git clean -fd')?.folder, '/home/dev/code/other repo');
    assert.equal(hazard('(cd packages/web && git stash)')?.folder, at('packages/web'));
  });

  test("pushd and popd, also PowerShell's Push-Location, Pop-Location and sl", () => {
    assert.equal(hazard('pushd packages/web && popd && git checkout .')?.folder, CWD);
    assert.equal(hazard('popd; git stash'), null, 'nothing to go back to: unknown');
    assert.equal(hazard('Push-Location C:\\work\\api; git stash; Pop-Location', 'C:\\x', { powershell: true })?.folder, 'C:/work/api');
    assert.equal(hazard('sl C:\\work\\api; git reset --hard', 'C:\\x', { powershell: true })?.folder, 'C:/work/api');
  });

  test('the work tree it acts on: a monorepo package belongs to the folder its crew started in', () => {
    assert.deepEqual(hazard('git stash', at('packages/web'), { sessionFolder: CWD }), { command: 'git stash', effect: 'discard', folder: at('packages/web'), root: CWD, paths: [] });
    assert.equal(hazard('git stash', '/srv/other', { sessionFolder: CWD })?.root, '/srv/other', 'not inside it: its own folder');
    assert.equal(hazard('git stash', `${CWD}/.claude/worktrees/feature/src`, { sessionFolder: CWD })?.root, `${CWD}/.claude/worktrees/feature`, 'a worktree Claude Code made is its own');
  });

  test('cd to $(git rev-parse --show-toplevel) goes to the top of the work tree', () => {
    for (const line of ['cd "$(git rev-parse --show-toplevel)" && git stash', 'cd $(git rev-parse --show-toplevel); git stash', 'cd `git rev-parse --show-toplevel` && git stash']) {
      assert.equal(hazard(line, at('packages/web'), { sessionFolder: CWD })?.folder, CWD, line);
    }
  });

  test('git -C names the folder, and options before the subcommand are skipped', () => {
    assert.equal(hazard('git -C ../billing stash')?.folder, '/home/dev/code/billing');
    assert.equal(hazard('git -C /srv/app -c core.pager=cat --no-pager reset --hard')?.folder, '/srv/app');
  });

  test('a folder it cannot tell (home, the last one, a variable) leaves what follows unjudged', () => {
    for (const line of ['cd ~ && git stash', 'cd ~/code/api && git stash', 'cd - && git stash', 'cd "$REPO" && git stash', 'cd && git stash', 'git -C "$REPO" stash']) {
      assert.equal(hazard(line), null, line);
    }
    assert.equal(hazard('git stash', ''), null, 'no folder at all');
    assert.equal(hazard('cd ~ && cd /srv/app && git stash')?.folder, '/srv/app', 'an absolute cd places it again');
  });

  test('a line of endless folder moves stays cheap: past 64 the folder is unknown', () => {
    const started = performance.now();
    assert.equal(hazard(`${'cd x;'.repeat(4000)} git stash`), null);
    assert.ok(performance.now() - started < 200, 'linear, not quadratic');
    assert.equal(hazard(`${'cd x;'.repeat(60)} git stash`)?.folder, `${CWD}${'/x'.repeat(60)}`);
  });

  test('the add and its commit may be apart on the line; the first hazard counts', () => {
    assert.equal(hazard('git add . && npm run lint && git commit -m "Lint"')?.command, 'git add . && git commit');
    assert.equal(hazard('git stash && git checkout main && git stash pop')?.command, 'git stash');
    assert.equal(hazard('git commit -m x && git add -A'), null, 'staged after the commit: nothing committed');
  });

  test('inside if and loops, behind sudo, env, nice, timeout, nohup or time', () => {
    assert.equal(hazard('if ! git diff --quiet; then git stash; fi')?.command, 'git stash');
    assert.equal(hazard('for f in src/*.ts; do git checkout -- "$f"; done')?.command, 'git checkout -- $f');
    for (const line of ['sudo git reset --hard', 'sudo -u bob git reset --hard', 'env GIT_EDITOR=true git reset --hard', 'env -u PAGER X=1 git reset --hard', 'nice -n 10 git reset --hard', 'nice git reset --hard', 'timeout 30 git reset --hard', 'timeout -k 5 --signal=TERM 30s git reset --hard', 'nohup git reset --hard', 'time git reset --hard', 'GIT_EDITOR=true git reset --hard']) {
      assert.equal(hazard(line)?.command, 'git reset --hard', line);
    }
    assert.equal(hazard('if git diff --quiet; then echo clean; fi'), null);
  });

  test("a shell's -c script, as Codex sends it, one level deep", () => {
    assert.equal(hazard("bash -lc 'git add -A && git commit -m wip'")?.command, 'git add -A && git commit');
    assert.equal(hazard(['bash', '-lc', 'cd packages/web && git stash'])?.folder, at('packages/web'));
    assert.equal(hazard('sh -c "git reset --hard"')?.command, 'git reset --hard');
    assert.equal(hazard("/bin/zsh -o pipefail -c 'git stash'")?.command, 'git stash');
    assert.equal(hazard(`bash -c "bash -c 'git stash'"`), null, 'not two levels deep');
  });

  test('a path to git, quoted paths, long ones cut', () => {
    assert.equal(hazard('/usr/bin/git stash')?.command, 'git stash');
    assert.equal(hazard('Git.exe stash')?.command, 'git stash');
    assert.deepEqual(hazard("git checkout -- 'src/a file.ts'")?.paths, [at('src/a file.ts')]);
    assert.equal(hazard(`git checkout -- ${'very/long/path/'.repeat(10)}a.ts`)?.command.length, 60);
  });

  test('a Codex argument list reads like the line it stands for', () => {
    assert.equal(hazard(['git', 'stash'])?.command, 'git stash');
    assert.equal(hazard(['git', 'stash', 'list']), null);
  });
});

describe('gitCommitsOf: what the commits on a line took in', () => {
  /** @param {string} line @param {string} [folder] */
  const commits = (line, folder = CWD) => gitCommitsOf(line, { folder, sessionFolder: CWD });

  test('everything with -a or a whole-tree add; else what was named', () => {
    assert.deepEqual(commits('git commit -am wip'), [{ folder: CWD, root: CWD, paths: [] }]);
    assert.deepEqual(commits('git add -A && git commit -m wip && git push'), [{ folder: CWD, root: CWD, paths: [] }]);
    assert.deepEqual(commits('git add src/a.ts src/b.ts && git commit -m "Fix"'), [{ folder: CWD, root: CWD, paths: [at('src/a.ts'), at('src/b.ts')] }]);
    assert.deepEqual(commits('git commit -m x src/', at('packages/web')), [{ folder: at('packages/web'), root: CWD, paths: [at('packages/web/src')] }]);
    assert.deepEqual(commits('git add a.ts && git commit -m 1 && git add b.ts && git commit -m 2').map((c) => c.paths), [[at('a.ts')], [at('b.ts')]]);
  });

  test('a commit of what was staged before the line takes in nothing known; no commit, nothing', () => {
    assert.deepEqual(commits('git commit -m "Staged earlier"'), []);
    assert.deepEqual(commits('git add -A'), []);
    assert.deepEqual(commits('git commit -a --dry-run'), []);
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
      assert.doesNotThrow(() => gitHazardOf(input, { folder: CWD }));
      assert.doesNotThrow(() => gitCommitsOf(input, { folder: CWD }));
    }
    assert.deepEqual(shellCommands({}), []);
    assert.deepEqual(shellCommands("echo 'unclosed"), [['echo', 'unclosed']]);
    assert.equal(hazard(`echo ${'x'.repeat(30_000)}; git stash`), null, 'past the length read, nothing is judged');
  });
});
