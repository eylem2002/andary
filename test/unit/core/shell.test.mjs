// Shell command lines read as a shell reads them (core/shell.js): the commands a line runs, each
// with its words, redirections, separator and pipeline, the program behind what only starts it,
// what the line's exit status proves of it, and where it runs. The lines are the kind agents
// write, Codex's argument lists and PowerShell included, and the kind written to fool a reader.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_MOVES, MAX_SHELL_CHARS, gitAction, isTestRun, normalizedPath, programOf, readShell, shellCommands } from '../../../public/js/core/shell.js';

/**
 * Each command a line runs, as "words" with S (the line succeeding proves it succeeded) and D (the
 * line failing proves it failed).
 * @param {unknown} line
 */
function read(line) {
  return shellCommands(line).map((c) => `${c.words.join(' ')}${c.succeeded || c.decides ? ` [${c.succeeded ? 'S' : ''}${c.decides ? 'D' : ''}]` : ''}`);
}

/** Each command's words as written (quotes resolved), redirections left out. @param {unknown} line @param {object} [options] */
const argvs = (line, options) => readShell(line, options).segments.map((s) => s.argv);

/** Where each command runs. @param {unknown} line @param {import('../../../public/js/core/shell.js').ShellOptions} options */
const folders = (line, options) => readShell(line, options).segments.map((s) => `${s.words.join(' ')} @ ${s.folder}`);

const CWD = '/home/dev/code/api';

describe('words', () => {
  test('quotes and escapes are resolved as bash resolves them', () => {
    assert.deepEqual(argvs('git commit -m "Fix the \\"login\\" bug" --author=\'A B\' a\\ b'), [['git', 'commit', '-m', 'Fix the "login" bug', '--author=A B', 'a b']]);
    assert.deepEqual(argvs('echo "C:\\temp" ""'), [['echo', 'C:\\temp', '']], 'in double quotes a backslash only escapes a few');
    assert.deepEqual(argvs("git commit -m 'it'\\''s done'"), [['git', 'commit', '-m', "it's done"]]);
    assert.deepEqual(argvs("printf $'a\\'b'"), [['printf', "a'b"]]);
    assert.deepEqual(argvs('echo a\\\nb'), [['echo', 'ab']], 'a backslash at the end of a line joins the next');
    assert.deepEqual(argvs('echo a#b # git stash'), [['echo', 'a#b']], 'a # inside a word is no comment; one after a blank is');
  });

  test('substitutions stay whole inside their word, here-documents and quotes in them too', () => {
    const message = 'git commit -m "$(cat <<\'EOF\'\nNever "git reset --hard"; it (really) can\'t be undone\nEOF\n)" && git push';
    assert.deepEqual(readShell(message).segments.map((s) => s.words.slice(0, 2)), [['git', 'commit'], ['git', 'push']]);
    assert.deepEqual(argvs('git commit -m "$(printf "Fix (issue 12) ) twice")" && git stash').map((w) => w[0]), ['git', 'git'], 'a ) in quotes inside $(…) does not end it');
    assert.deepEqual(argvs('echo $(git push) `git push` > out.txt'), [['echo', '$(git push)', '`git push`']]);
  });

  test('PowerShell: a backtick escapes, backslashes are path separators', () => {
    assert.deepEqual(argvs('Set-Location C:\\work\\api; Write-Host "a`"b"', { powershell: true }), [['Set-Location', 'C:\\work\\api'], ['Write-Host', 'a"b']]);
  });
});

describe('segments, separators and pipelines', () => {
  test('a line splits at &&, ||, ;, |, |&, &, newlines and parentheses, each command keeping the separator after it', () => {
    const { segments } = readShell('cd app && (npm ci; npm test 2>&1 | tail -5) || echo failed &\nls');
    assert.deepEqual(
      segments.map((s) => [s.text, s.separator, s.pipeline]),
      [['cd app', '&&', 0], ['npm ci', ';', 1], ['npm test 2>&1', '|', 2], ['tail -5', '||', 2], ['echo failed', '&', 3], ['ls', '', 4]],
    );
  });

  test('keywords are no commands; a condition says so, and fi or done hand their separator back', () => {
    const { segments } = readShell('if ! git diff --quiet; then git stash; fi && echo done');
    assert.deepEqual(segments.map((s) => [s.argv.join(' '), s.condition, s.separator]), [['git diff --quiet', true, ';'], ['git stash', false, '&&'], ['echo done', false, '']]);
    assert.deepEqual(argvs('for f in src/*.ts; do git checkout -- "$f"; done'), [['for', 'f', 'in', 'src/*.ts'], ['git', 'checkout', '--', '$f']]);
    assert.deepEqual(argvs('{ npm test; }'), [['npm', 'test']]);
  });

  test('the text of a command is as written, whitespace collapsed', () => {
    assert.deepEqual(readShell("cd /work/app &&  npm   test  -- 'a  b'").segments.map((s) => s.text), ['cd /work/app', "npm test -- 'a b'"]);
  });
});

describe('redirections and here-documents', () => {
  test('kept apart from the words, with their targets', () => {
    const { segments } = readShell('npm test > out.log 2> err.log && git stash >/dev/null &>> all.log; echo 2 > x.txt; wc -l <<< "git stash"; cat < in.txt 2>&1 >| clobber.txt');
    assert.deepEqual(segments.map((s) => s.argv), [['npm', 'test'], ['git', 'stash'], ['echo', '2'], ['wc', '-l'], ['cat']]);
    assert.deepEqual(
      segments.map((s) => s.redirects.map((r) => `${r.fd}${r.op}${r.target}`)),
      [['>out.log', '2>err.log'], ['>/dev/null', '&>>all.log'], ['>x.txt'], ['<<<git stash'], ['<in.txt', '2>&1', '>|clobber.txt']],
      'a number before a blank is an argument, one right before the operator its descriptor',
    );
  });

  test("here-document bodies are no commands, and are there for those who need them", () => {
    const { segments } = readShell("cat > notes.md <<'EOF'\ngit stash\ngit reset --hard\nEOF\necho done");
    assert.deepEqual(segments.map((s) => s.argv), [['cat'], ['echo', 'done']]);
    assert.deepEqual(segments[0].redirects, [
      { op: '>', fd: '', target: 'notes.md', body: null },
      { op: '<<', fd: '', target: 'EOF', body: 'git stash\ngit reset --hard' },
    ]);
    const tabs = readShell('cat <<-END\n\tgit clean -fd\n\tEND\nls').segments;
    assert.deepEqual([tabs.map((s) => s.argv), tabs[0].redirects[0].body], [[['cat'], ['ls']], 'git clean -fd']);
    const two = readShell('cat <<A <<"B"\none\nA\ntwo\nB\nls').segments;
    assert.deepEqual([two.map((s) => s.argv), two[0].redirects.map((r) => r.body)], [[['cat'], ['ls']], ['one', 'two']]);
    assert.deepEqual(readShell("git commit -F - <<'EOF'\nfix: git push later\nEOF\ngit push").segments.map((s) => s.words.slice(0, 2)), [['git', 'commit'], ['git', 'push']]);
  });
});

describe("a shell's -c script", () => {
  test('is read in its place, one level deep, from a line or a Codex argument list', () => {
    assert.deepEqual(read("bash -lc 'cd app && npm test'"), ['cd app [S]', 'npm test [SD]']);
    assert.deepEqual(read(['bash', '-lc', 'cd app && npm test']), ['cd app [S]', 'npm test [SD]']);
    assert.deepEqual(read("/bin/zsh -o pipefail -c 'git stash'"), ['git stash [SD]']);
    assert.deepEqual(read('sh -c "git reset --hard"'), ['git reset --hard [SD]']);
    assert.deepEqual(read("sudo bash -c 'rm -rf build'"), ['rm -rf build [SD]']);
    assert.deepEqual(read("bash -lc 'npm test' | tail"), ['npm test', 'tail [SD]']);
    assert.deepEqual(read(`bash -c "bash -c 'git stash'"`), ['bash -c git stash [SD]'], 'not two levels deep');
    assert.deepEqual(read('bash script.sh'), ['bash script.sh [SD]'], 'a script file is not read');
    const inner = readShell(['bash', '-lc', "echo 'it'\\''s' | wc -c"]).segments;
    assert.deepEqual(inner.map((s) => [s.text, s.depth, s.separator, s.pipeline]), [["echo 'it'\\''s'", 1, '|', 0], ['wc -c', 1, '', 0]], 'its text as the script reads');
  });
});

describe('what the exit status proves', () => {
  test('the last item decides, a pipe reports its last command (all with pipefail), || and & prove nothing', () => {
    /** @type {[string, string[]][]} */
    const table = [
      ['npm test', ['npm test [SD]']],
      ['cd app && npm test', ['cd app [S]', 'npm test [SD]']],
      ['npm run build && npm test', ['npm run build [S]', 'npm test [S]']],
      ['npm test; echo done', ['npm test', 'echo done [SD]']],
      ['npm ci\nnpm test', ['npm ci', 'npm test [SD]']],
      ['npm test || true', ['npm test', 'true']],
      ['npm test 2>&1 | tail -20', ['npm test', 'tail -20 [SD]']],
      ['set -o pipefail; npm test 2>&1 | tail -20', ['set -o pipefail', 'npm test [SD]', 'tail -20 [S]']],
      ['set -euo pipefail\nnpm test | tee out.log', ['set -euo pipefail', 'npm test [SD]', 'tee out.log [S]']],
      ['set -o pipefail; set +o pipefail; npm test | tail', ['set -o pipefail', 'set +o pipefail', 'npm test', 'tail [SD]']],
      ['npm test &', ['npm test']],
      ['(cd app && npm test)', ['cd app [S]', 'npm test [SD]']],
      ['if npm test; then echo ok; fi', ['npm test', 'echo ok [SD]']],
      ['{ npm test; }', ['npm test [SD]']],
      ['time npm test', ['npm test [SD]']],
      ['rg -n "vitest" package.json', ['rg -n vitest package.json [SD]']],
      ['npm test # and then git push', ['npm test [SD]']],
      ['npm test 2>&1 > log.txt', ['npm test [SD]']],
    ];
    for (const [line, expected] of table) assert.deepEqual(read(line), expected, line);
    assert.equal(readShell('set -o pipefail; npm test | tail').pipefail, true);
  });
});

describe('the program a command runs', () => {
  test('behind assignments, wrappers with their options and launchers, by its file name', () => {
    /** @type {[string[], string[]][]} */
    const table = [
      [['X=1', 'CI=true', 'npm', 'test'], ['npm', 'test']],
      [['npx', '-y', 'vitest', 'run'], ['vitest', 'run']],
      [['pnpm', 'exec', 'jest'], ['jest']],
      [['uv', 'run', 'pytest', '-q'], ['pytest', '-q']],
      [['poetry', 'run', 'pytest'], ['pytest']],
      [['bundle', 'exec', 'rspec'], ['rspec']],
      [['python3', '-m', 'pytest', 'tests'], ['pytest', 'tests']],
      [['env', 'FOO=1', 'time', 'npm', 'test'], ['npm', 'test']],
      [['env', '-u', 'PAGER', 'X=1', 'git', 'reset', '--hard'], ['git', 'reset', '--hard']],
      [['timeout', '600', 'cargo', 'test'], ['cargo', 'test']],
      [['timeout', '-k', '5', '--signal=TERM', '30s', 'git', 'reset', '--hard'], ['git', 'reset', '--hard']],
      [['sudo', '-u', 'bob', 'git', 'reset', '--hard'], ['git', 'reset', '--hard']],
      [['nice', '-n', '10', 'git', 'stash'], ['git', 'stash']],
      [['nice', 'git', 'stash'], ['git', 'stash']],
      [['nohup', 'stdbuf', '-o', 'L', 'npm', 'start'], ['npm', 'start']],
      [['./node_modules/.bin/vitest'], ['vitest']],
      [['/usr/bin/git', 'push'], ['git', 'push']],
      [['Git.exe', 'stash'], ['git', 'stash']],
      [['X=1'], []],
    ];
    for (const [words, expected] of table) assert.deepEqual(programOf(words), expected, words.join(' '));
  });
});

describe('a test run, a commit or a push', () => {
  test('a runner in command position, never one named in an argument', () => {
    /** @type {[string, boolean][]} */
    const table = [
      ['npm test', true],
      ['npm run test:unit', true],
      ['yarn jest --watch=false', true],
      ['bun test', true],
      ['X=1 npx playwright test', true],
      ['cd app && npm test', true],
      ['python -m pytest', true],
      ['python3 -m unittest discover', true],
      ['go test ./...', true],
      ['node --test test/', true],
      ['make test', true],
      ['rg -n "vitest" package.json', false],
      ['npm install -D vitest', false],
      ['pip install pytest', false],
      ['grep -rn "npm test" README.md', false],
      ['npm run build', false],
      ['make', false],
      ['node test.js', false],
    ];
    for (const [line, expected] of table) assert.equal(shellCommands(line).some((c) => isTestRun(c.words)), expected, line);
  });

  test('git in command position, after its own options; a dry run is neither', () => {
    /** @type {[string, (string|null)[]][]} */
    const table = [
      ['git commit -m "fix"', ['commit']],
      ['git -C repo commit -m x', ['commit']],
      ['git -c commit.gpgsign=false commit -m x', ['commit']],
      ['git commit -m a && git commit -m b && git push -u origin main', ['commit', 'commit', 'push']],
      ['git commit -m "Explain why git push needs a remote"', ['commit']],
      ['git push --dry-run', [null]],
      ['git push -n origin main', [null]],
      ['echo "do the git push later"', [null]],
      ['git -C repo', [null]],
    ];
    for (const [line, expected] of table) assert.deepEqual(shellCommands(line).map((c) => gitAction(c.words)), expected, line);
  });
});

describe('where each command runs', () => {
  test('cd, pushd and popd move the folder for the rest of the line; env -C for its own command', () => {
    assert.deepEqual(folders('cd packages/web && npm test; cd ../.. && ls', { folder: CWD }), [`cd packages/web @ ${CWD}`, `npm test @ ${CWD}/packages/web`, `cd ../.. @ ${CWD}/packages/web`, `ls @ ${CWD}`]);
    assert.deepEqual(folders('pushd packages/web && popd && git checkout .', { folder: CWD }).at(-1), `git checkout . @ ${CWD}`);
    assert.deepEqual(folders('popd; git stash', { folder: CWD }).at(-1), 'git stash @ null', 'nothing to go back to: unknown');
    assert.deepEqual(folders('env -C /srv/app true; git stash', { folder: CWD }), ['true @ /srv/app', `git stash @ ${CWD}`]);
    assert.deepEqual(folders('env --chdir=/srv/app GIT_EDITOR=true git reset --hard', { folder: CWD }), ['git reset --hard @ /srv/app']);
    assert.deepEqual(folders('env -Cpackages/web git stash', { folder: CWD }), [`git stash @ ${CWD}/packages/web`]);
  });

  test("a shell's script moves in a shell of its own", () => {
    assert.deepEqual(folders(['bash', '-lc', 'cd packages/web && git stash'], { folder: CWD }).at(-1), `git stash @ ${CWD}/packages/web`);
    assert.deepEqual(folders("bash -c 'cd /tmp' && ls", { folder: CWD }).at(-1), `ls @ ${CWD}`);
  });

  test('PowerShell: Set-Location, sl, Push-Location and Pop-Location', () => {
    assert.deepEqual(folders('Push-Location C:\\work\\api; git stash; Pop-Location; ls', { folder: 'C:/x', powershell: true }).slice(1), ['git stash @ C:/work/api', 'pop-location @ C:/work/api', 'ls @ C:/x']);
    assert.deepEqual(folders('sl C:\\work\\api; git reset --hard', { folder: 'C:/x', powershell: true }).at(-1), 'git reset --hard @ C:/work/api');
  });

  test('to the top of the work tree, and on from there, when the caller knows where that is', () => {
    for (const line of ['cd "$(git rev-parse --show-toplevel)" && git stash', 'cd $(git rev-parse --show-toplevel); git stash', 'cd `git rev-parse --show-toplevel` && git stash']) {
      assert.equal(folders(line, { folder: `${CWD}/packages/web`, root: CWD }).at(-1), `git stash @ ${CWD}`, line);
      assert.equal(folders(line, { folder: `${CWD}/packages/web` }).at(-1), 'git stash @ null', `${line}: unknown`);
    }
    assert.equal(folders('cd "$(git rev-parse --show-toplevel)/src" && git clean -f', { folder: `${CWD}/web`, root: (from) => (from ? CWD : null) }).at(-1), `git clean -f @ ${CWD}/src`);
  });

  test('a folder it cannot tell (home, the last one, a variable, none at all) is unknown until an absolute cd', () => {
    for (const line of ['cd ~ && git stash', 'cd ~/code/api && git stash', 'cd - && git stash', 'cd "$REPO" && git stash', 'cd && git stash']) {
      assert.equal(folders(line, { folder: CWD }).at(-1), 'git stash @ null', line);
    }
    assert.equal(folders('cd ~ && cd /srv/app && git stash', { folder: CWD }).at(-1), 'git stash @ /srv/app');
    assert.equal(folders('git stash', {}).at(-1), 'git stash @ null', 'no starting folder');
    assert.equal(folders('cd /c/work && git stash', { folder: CWD, resolve: (_from, target) => target.replace(/^\/c\//, 'C:/') }).at(-1), 'git stash @ C:/work', "the caller's own path rules");
  });

  test(`a line of endless moves stays cheap: past ${MAX_MOVES} the folder is unknown`, () => {
    const started = performance.now();
    assert.equal(folders(`${'cd x;'.repeat(3000)} git stash`, { folder: CWD }).at(-1), 'git stash @ null');
    assert.ok(performance.now() - started < 200, 'linear, not quadratic');
    assert.equal(folders(`${'cd x;'.repeat(60)} git stash`, { folder: CWD }).at(-1), `git stash @ ${CWD}${'/x'.repeat(60)}`);
  });

  test('paths without . and .. segments', () => {
    for (const [path, expected] of [['/a/./b/../c/', '/a/c'], ['a//b', 'a/b'], ['../x/./y', '../x/y'], ['/..', '/..'], ['/', '/'], ['.', '.'], ['C:/w/../x', 'C:/x']]) {
      assert.equal(normalizedPath(path), expected, path);
    }
  });
});

describe('defensive: any input, bounded work, never throws', () => {
  test('odd and unfinished lines', () => {
    for (const input of [undefined, null, 42, {}, 'echo "unclosed', "echo 'unclosed", 'echo $(unclosed', 'a\\', '<<', '2>&', 'cat <<EOF\nno end', ')(', '((', '|||', ';;&&', '$', '`unclosed']) {
      assert.doesNotThrow(() => readShell(input), String(input));
    }
    for (const input of ['', '   ', '# only a comment', undefined, null, 42, {}]) assert.deepEqual(shellCommands(input), [], String(input));
    assert.deepEqual(argvs("echo 'unclosed"), [['echo', 'unclosed']], 'an unclosed quote runs to the end');
    assert.deepEqual(read(['npm', 'test']), ['npm test [SD]'], 'a Codex argument list reads like the line it stands for');
  });

  test(`past ${MAX_SHELL_CHARS} characters only the start is read`, () => {
    const started = performance.now();
    const long = readShell(`${'x'.repeat(100_000)} git stash`);
    assert.ok(performance.now() - started < 200);
    assert.deepEqual([long.truncated, long.segments.some((s) => s.program === 'git')], [true, false]);
    assert.equal(readShell(`echo ${'x'.repeat(30_000)}; git stash`).segments.length, 1, 'past the length read, nothing is judged');
    const quotes = `echo ${'"a" \'b\' $(c) '.repeat(2_000)}`;
    const t = performance.now();
    readShell(quotes);
    assert.ok(performance.now() - t < 200, 'quotes and substitutions stay linear');
  });
});
