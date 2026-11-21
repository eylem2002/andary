// Git commands that put other agents' uncommitted work at risk (core/git-commands.js): each one it
// recognises with what it acts on, the ones it must leave alone, and command lines read as a shell
// reads them (chains, cd, quotes, redirections, here-documents, a shell's -c script), so a commit
// message that mentions a command is not that command.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_SPECS, gitAddsOf, gitCommitsOf, gitHazardOf } from '../../../public/js/core/git-commands.js';
import { isInside } from '../../../public/js/core/paths.js';

const CWD = '/home/dev/code/api-server';

/**
 * @param {unknown} command @param {string} [folder]
 * @param {import('../../../public/js/core/git-commands.js').ReadOptions & { sessionFolder?: string, root?: string }} [options]
 */
const hazard = (command, folder = CWD, options = {}) => gitHazardOf(command, { folder, sessionFolder: options.sessionFolder ?? folder, root: options.root }, options);
/** @param {string} rel */
const at = (rel) => `${CWD}/${rel}`;

describe('gitHazardOf: the commands it recognises, and what each acts on', () => {
  /** @type {[string, string, 'sweep'|'discard', 'tracked'|'untracked'|'all', string[]][]} the line, its words, its effect, which files, its paths (none: the whole work tree) */
  const RECOGNISED = [
    ['git add -A && git commit -m "Save the work"', 'git add -A && git commit', 'sweep', 'all', []],
    ['git add . && git commit -m "Save the work"', 'git add . && git commit', 'sweep', 'all', [CWD]],
    ['git add --all; git commit -m wip', 'git add -A && git commit', 'sweep', 'all', []],
    ['git add -u && git commit --amend --no-edit', 'git add -u && git commit', 'sweep', 'tracked', []],
    ['git add :/ && git commit -m x', 'git add :/ && git commit', 'sweep', 'all', []],
    ['git add src/auth.ts lib && git commit -m "Fix auth"', 'git add src/auth.ts lib && git commit', 'sweep', 'all', [at('src/auth.ts'), at('lib')]],
    ['git commit -a -m "Save"', 'git commit -a', 'sweep', 'tracked', []],
    ['git commit -am "Save"', 'git commit -a', 'sweep', 'tracked', []],
    ['git commit --all --message=wip', 'git commit -a', 'sweep', 'tracked', []],
    ['git commit .', 'git commit .', 'sweep', 'tracked', [CWD]],
    ['git commit -m x src/', 'git commit src/', 'sweep', 'tracked', [at('src')]],
    ['git stash', 'git stash', 'discard', 'tracked', []],
    ['git stash push -m "before the rebase"', 'git stash', 'discard', 'tracked', []],
    ['git stash save wip', 'git stash', 'discard', 'tracked', []],
    ['git stash -u', 'git stash', 'discard', 'all', []],
    ['git stash -- src/auth.ts', 'git stash -- src/auth.ts', 'discard', 'tracked', [at('src/auth.ts')]],
    ['git stash push -m keep src/auth.ts', 'git stash -- src/auth.ts', 'discard', 'tracked', [at('src/auth.ts')]],
    ['git checkout .', 'git checkout .', 'discard', 'tracked', [CWD]],
    ['git checkout -- src/auth.ts', 'git checkout -- src/auth.ts', 'discard', 'tracked', [at('src/auth.ts')]],
    ['git checkout HEAD~1 -- src/*.ts', 'git checkout -- src/*.ts', 'discard', 'tracked', [at('src')]],
    ['git checkout -f main', 'git checkout -f', 'discard', 'tracked', []],
    ['git switch --discard-changes main', 'git switch --discard-changes', 'discard', 'tracked', []],
    ['git switch -f main', 'git switch --discard-changes', 'discard', 'tracked', []],
    ['git restore src/auth.ts', 'git restore src/auth.ts', 'discard', 'tracked', [at('src/auth.ts')]],
    ['git restore --source=HEAD~1 .', 'git restore .', 'discard', 'tracked', [CWD]],
    ['git restore -s HEAD~1 src/auth.ts', 'git restore src/auth.ts', 'discard', 'tracked', [at('src/auth.ts')]],
    ['git restore --staged --worktree src/auth.ts', 'git restore src/auth.ts', 'discard', 'tracked', [at('src/auth.ts')]],
    ['git reset --hard', 'git reset --hard', 'discard', 'tracked', []],
    ['git reset --hard origin/main', 'git reset --hard', 'discard', 'tracked', []],
    ['git clean -f', 'git clean -f', 'discard', 'untracked', [CWD]],
    ['git clean -xdf', 'git clean -fdx', 'discard', 'untracked', [CWD]],
    ['git clean --force -d -e "*.log" build', 'git clean -fd build', 'discard', 'untracked', [at('build')]],
  ];
  for (const [line, words, effect, files, paths] of RECOGNISED) {
    test(line, () => assert.deepEqual(hazard(line), { command: words, effect, folder: CWD, root: CWD, exact: false, files, paths }));
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
    'git commit -uall -m x',
    'git commit -Sabcdef -m x',
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
    assert.deepEqual(hazard('git stash', at('packages/web'), { sessionFolder: CWD }), { command: 'git stash', effect: 'discard', folder: at('packages/web'), root: CWD, exact: false, files: 'tracked', paths: [] });
    assert.equal(hazard('git stash', '/srv/other', { sessionFolder: CWD })?.root, '/srv/other', 'not inside it: its own folder');
    assert.equal(hazard('git stash', `${CWD}/.claude/worktrees/feature/src`, { sessionFolder: CWD })?.root, `${CWD}/.claude/worktrees/feature`, 'a worktree Claude Code made is its own');
  });

  test('the top the server found on disk, for any folder in it but a worktree Claude Code made there', () => {
    const web = at('packages/web');
    assert.deepEqual(hazard('git stash', web, { sessionFolder: '/home/dev', root: web }), { command: 'git stash', effect: 'discard', folder: web, root: web, exact: true, files: 'tracked', paths: [] }, 'a repository of its own in a workspace');
    assert.deepEqual([hazard('cd src && git stash', web, { root: web })?.root, hazard('cd src && git stash', web, { root: web })?.exact], [web, true]);
    assert.deepEqual([hazard('cd ../api && git stash', web, { sessionFolder: CWD, root: web })?.root, hazard('cd ../api && git stash', web, { sessionFolder: CWD, root: web })?.exact], [CWD, false], 'outside it: guessed');
    assert.equal(hazard('cd .claude/worktrees/x && git stash', CWD, { root: CWD })?.root, `${CWD}/.claude/worktrees/x`);
  });

  test('cd to $(git rev-parse --show-toplevel) goes to the top of the work tree, and on from there', () => {
    for (const line of ['cd "$(git rev-parse --show-toplevel)" && git stash', 'cd $(git rev-parse --show-toplevel); git stash', 'cd `git rev-parse --show-toplevel` && git stash']) {
      assert.equal(hazard(line, at('packages/web'), { sessionFolder: CWD })?.folder, CWD, line);
    }
    assert.equal(hazard('cd "$(git rev-parse --show-toplevel)/src" && git clean -f', at('packages/web'), { sessionFolder: CWD })?.folder, at('src'));
    assert.equal(hazard('cd "$(git rev-parse --show-toplevel)/lib" && git stash', at('packages/web'), { sessionFolder: '/home/dev', root: at('packages') })?.folder, at('packages/lib'), 'from the top found on disk');
  });

  test('Git Bash writes a drive as a folder: /c/work is C:/work when the crew works on a drive', () => {
    assert.equal(hazard('cd /c/work/api && git stash', 'C:\\Users\\dev')?.folder, 'C:/work/api');
    assert.equal(hazard('git -C /d stash', 'C:\\Users\\dev')?.folder, 'D:/');
    assert.equal(hazard('cd /c/work && git stash')?.folder, '/c/work', 'not on a drive: a folder like any other');
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

  test('env -C runs its own command in another folder', () => {
    assert.equal(hazard('env -C packages/web git stash')?.folder, at('packages/web'));
    assert.equal(hazard('env -Cpackages/web git stash')?.folder, at('packages/web'));
    assert.equal(hazard('env --chdir=/srv/app GIT_EDITOR=true git reset --hard')?.folder, '/srv/app');
    assert.equal(hazard('env --chdir /srv/app git reset --hard')?.folder, '/srv/app');
    assert.equal(hazard('env -u PAGER -C /srv/app git stash')?.folder, '/srv/app');
    assert.equal(hazard('env -C /srv/app true; git stash')?.folder, CWD, 'only its own command');
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

describe('gitHazardOf: pathspecs as git reads them', () => {
  /** @param {string} line @param {string} [folder] */
  const paths = (line, folder = CWD) => hazard(line, folder, { sessionFolder: CWD })?.paths;

  test("magic: :/ and :(top) from the top, exclusions left out, glob, icase and literal read", () => {
    assert.deepEqual(paths("git add ':/src' && git commit -m x", at('packages/web')), [at('src')]);
    assert.deepEqual(paths("git restore ':(top)lib/a.ts'", at('packages/web')), [at('lib/a.ts')]);
    assert.deepEqual(paths("git checkout -- ':(glob)src/**/*.ts'"), [at('src')]);
    assert.deepEqual(paths("git restore ':(icase)README.md'"), [at('README.md')]);
    assert.deepEqual(paths("git restore ':(literal)a*b.ts'"), [at('a*b.ts')]);
    assert.deepEqual(paths("git restore src ':!src/keep.ts'"), [at('src')], 'an exclusion beside a path: the path');
  });

  test('only exclusions: as with no pathspec, the whole work tree or the folder', () => {
    assert.deepEqual(paths("git stash push -- ':!vendor'"), []);
    assert.deepEqual(paths("git add ':(exclude)dist' && git commit -m x"), []);
    assert.deepEqual(paths("git clean -f ':^build'", at('packages/web')), [at('packages/web')]);
    assert.deepEqual(paths("git restore ':!a.ts'", at('packages/web')), [at('packages/web')]);
  });

  test(`the same path once, and past ${MAX_SPECS} as with none`, () => {
    assert.deepEqual(paths('git add a.ts a.ts ./a.ts && git commit -m x'), [at('a.ts')]);
    const many = Array.from({ length: MAX_SPECS + 1 }, (_, i) => `f${i}.ts`).join(' ');
    assert.deepEqual(paths(`git add ${many} && git commit -m x`), []);
    assert.deepEqual(paths(`git restore ${many}`), [CWD]);
    assert.equal(paths(`git restore ${many.split(' ').slice(1).join(' ')}`)?.length, MAX_SPECS);
  });

  test('git checkout <path> without --: a path when agents changed it, or a file in it; else a branch', () => {
    const changed = at('src/auth.ts');
    const known = (/** @type {string} */ path) => isInside(changed, path);
    assert.deepEqual(hazard('git checkout src/auth.ts', CWD, { known })?.paths, [changed]);
    assert.deepEqual(hazard('git checkout src', CWD, { known })?.paths, [at('src')]);
    assert.deepEqual(hazard('git checkout HEAD~1 src/auth.ts', CWD, { known })?.command, 'git checkout src/auth.ts');
    assert.equal(hazard('git checkout main', CWD, { known }), null);
    assert.equal(hazard('git checkout src/auth.ts'), null, 'nothing known: a branch');
  });
});

describe('a commit in a later call than its git add', () => {
  const place = { folder: CWD, sessionFolder: CWD };
  const message = 'git commit -m "$(cat <<\'EOF\'\nFix auth\nEOF\n)"';

  test('gitAddsOf: what a line leaves staged, after its last commit', () => {
    assert.deepEqual(gitAddsOf('git add src/a.ts', place), [{ command: 'git add src/a.ts', folder: CWD, root: CWD, exact: false, files: 'all', paths: [at('src/a.ts')] }]);
    assert.deepEqual(gitAddsOf('git add -u', place).map((add) => [add.files, add.paths]), [['tracked', []]]);
    assert.deepEqual(gitAddsOf('git add a.ts && git commit -m x', place), []);
    assert.deepEqual(gitAddsOf('git commit -m x && git add b.ts', place).map((add) => add.paths), [[at('b.ts')]]);
    assert.deepEqual(gitAddsOf('git add -n .', place), []);
  });

  test('the commit counts what was staged before: a hazard, and what it took in', () => {
    const staged = gitAddsOf('git add -A', place);
    assert.deepEqual(gitHazardOf(message, place, { staged }), { command: 'git commit after git add -A', effect: 'sweep', folder: CWD, root: CWD, exact: false, files: 'all', paths: [] });
    assert.equal(gitHazardOf('git add b.ts && git commit -m x', place, { staged })?.command, 'git add b.ts && git commit', 'named after the add on its line');
    assert.deepEqual(gitCommitsOf(message, place, { staged }), [{ folder: CWD, root: CWD, exact: false, tracked: false, clears: true, paths: [] }]);
    assert.equal(gitHazardOf(message, { folder: '/srv/other', sessionFolder: '/srv/other' }, { staged }), null, 'staged in another work tree');
    assert.deepEqual(gitCommitsOf('git commit -m x src/', place, { staged }).map((c) => c.clears), [false], 'a commit of named paths leaves the rest staged');
  });
});

describe('gitCommitsOf: what the commits on a line took in', () => {
  /** @param {string} line @param {string} [folder] */
  const commits = (line, folder = CWD) => gitCommitsOf(line, { folder, sessionFolder: CWD });
  const whole = { folder: CWD, root: CWD, exact: false };

  test('everything with -a or a whole-tree add; else what was named', () => {
    assert.deepEqual(commits('git commit -am wip'), [{ ...whole, tracked: true, clears: true, paths: [] }]);
    assert.deepEqual(commits('git add -A && git commit -m wip && git push'), [{ ...whole, tracked: false, clears: true, paths: [] }]);
    assert.deepEqual(commits('git add -u && git commit -m wip'), [{ ...whole, tracked: true, clears: true, paths: [] }]);
    assert.deepEqual(commits('git add src/a.ts src/b.ts && git commit -m "Fix"'), [{ ...whole, tracked: false, clears: true, paths: [at('src/a.ts'), at('src/b.ts')] }]);
    assert.deepEqual(commits('git commit -m x src/', at('packages/web')), [{ folder: at('packages/web'), root: CWD, exact: false, tracked: true, clears: false, paths: [at('packages/web/src')] }]);
    assert.deepEqual(commits('git add a.ts && git commit -m 1 && git add b.ts && git commit -m 2').map((c) => c.paths), [[at('a.ts')], [at('b.ts')]]);
  });

  test('a commit of what was staged before the line takes in nothing known; no commit, nothing', () => {
    assert.deepEqual(commits('git commit -m "Staged earlier"'), []);
    assert.deepEqual(commits('git add -A'), []);
    assert.deepEqual(commits('git commit -a --dry-run'), []);
  });
});

describe('the line as core/shell.js reads it', () => {
  test('quotes, redirections and comments are no commands of their own', () => {
    assert.deepEqual(hazard("git checkout -- 'src/a file.ts' 2>&1 | tail -5")?.paths, [at('src/a file.ts')]);
    assert.equal(hazard('npm test > "git stash.log" 2> err.log # git stash'), null);
    assert.equal(hazard('wc -l <<< "git stash"'), null);
  });

  test('a commit message that mentions a command is not that command', () => {
    const line = 'git commit -m "$(cat <<\'EOF\'\nNever "git reset --hard"; it (really) can\'t be undone\nEOF\n)" && git push';
    assert.equal(hazard(line), null);
    const nested = 'git commit -m "$(printf "Fix (issue 12) ) twice")" && git stash';
    assert.equal(hazard(nested)?.command, 'git stash', 'a ) in quotes inside $(…) does not end it');
  });

  test('here-document bodies are no commands', () => {
    assert.equal(hazard("cat > notes.md <<'EOF'\ngit stash\ngit reset --hard\nEOF\necho done"), null);
    assert.equal(hazard('cat <<-END\n\tgit clean -fd\n\tEND\nls'), null);
    assert.equal(hazard("cat > notes.md <<'EOF'\ngit stash\nEOF\ngit stash")?.command, 'git stash', 'the line after the body is');
  });

  test("a cd inside a shell's -c script stays in that shell", () => {
    assert.equal(hazard("bash -c 'cd packages/web' && git stash")?.folder, CWD);
    assert.equal(hazard("(cd packages/web) && git stash")?.folder, at('packages/web'), 'a subshell of parentheses is taken to carry it, as before');
  });

  test('defensive: any input, never throws', () => {
    for (const input of [undefined, null, 42, {}, 'echo "unclosed', "echo 'unclosed", 'echo $(unclosed', 'a\\', `${'x'.repeat(100_000)} git stash`, '<<', '2>&', 'cat <<EOF\nno end']) {
      assert.doesNotThrow(() => gitHazardOf(input, { folder: CWD }));
      assert.doesNotThrow(() => gitCommitsOf(input, { folder: CWD }));
      assert.doesNotThrow(() => gitAddsOf(input, { folder: CWD }));
    }
    assert.equal(hazard(`echo ${'x'.repeat(30_000)}; git stash`), null, 'past the length read, nothing is judged');
  });

  test(`many git -C on one command stay cheap: past 64 the folder is unknown`, () => {
    const started = performance.now();
    assert.equal(hazard(`git ${'-C x '.repeat(3000)}stash`), null);
    assert.ok(performance.now() - started < 200);
    assert.equal(hazard(`git ${'-C x '.repeat(10)}stash`)?.folder, `${CWD}${'/x'.repeat(10)}`);
  });
});
