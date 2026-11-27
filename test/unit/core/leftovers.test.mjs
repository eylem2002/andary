import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftoverCommands, readLeftovers, serverStart } from '../../../public/js/core/leftovers.js';

/** @param {string} command @param {Record<string, unknown>} [extra] */
const bash = (command, extra = {}) => serverStart('Bash', { command, ...extra }, '/work/app');

test('servers a shell call starts, with the port the line names or the tool\'s fixed default', () => {
  /** @type {[string, number|null, boolean][]} command, port, background */
  const cases = [
    ['npm run dev', null, false],
    ['npm run dev -- --port 4000', 4000, false],
    ['pnpm dev &', null, true],
    ['yarn start', null, false],
    ['bun run serve:docs', null, false],
    ['npm run preview -- --port=4173', 4173, false],
    ['npx vite', 5173, false],
    ['vite --port 3001 &', 3001, true],
    ['npx vite preview', 4173, false],
    ['PORT=5000 node server.js &', 5000, true],
    ['next dev -p 3100', 3100, false],
    ['npx next start', 3000, false],
    ['nohup python3 -m http.server 8080 > /dev/null 2>&1 &', 8080, true],
    ['python -m http.server', 8000, false],
    ['python manage.py runserver 0.0.0.0:8001', 8001, false],
    ['rails s -p 3002', 3002, false],
    ['bundle exec rails server', 3000, false],
    ['flask run --port 5001', 5001, false],
    ['uvicorn app.main:app --reload --port 8100', 8100, false],
    ['gunicorn -b 127.0.0.1:9000 app:app', 9000, false],
    ['php -S localhost:8088', 8088, false],
    ['ng serve', 4200, false],
    ['hugo server', 1313, false],
    ['npx http-server dist -p 9090', 9090, false],
    ['npx serve -l 4500 dist', 4500, false],
    ['cd web && pnpm dev', null, false],
    ['setsid npx json-server db.json &', 3000, true],
  ];
  for (const [command, port, background] of cases) {
    const start = bash(command);
    assert.ok(start, command);
    assert.equal(start.port, port, command);
    assert.equal(start.background, background, command);
  }
});

test('Claude Code\'s run_in_background counts as background; the folder follows a cd', () => {
  const start = bash('cd site && npm run dev', { run_in_background: true });
  assert.equal(start?.background, true);
  assert.equal(start?.folder, '/work/app/site');
});

test('commands that start no server are not leftovers', () => {
  for (const command of ['npm test', 'npm run build', 'vite build', 'next build', 'npx tsc -p .', 'python script.py', 'git push', 'ls -la', 'sleep 30 &', 'mkdir -p dist &', 'cat package.json', 'npm run lint']) {
    assert.equal(bash(command), null, command);
  }
  assert.equal(serverStart('Read', { command: 'npm run dev' }), null);
  assert.equal(serverStart('Bash', null), null);
  assert.equal(serverStart('Bash', { command: 42 }), null);
});

test('a program of yours in the background that names its port counts; other commands\' -p never do', () => {
  assert.equal(bash('./bin/api --port 7070 &')?.port, 7070);
  assert.equal(bash('node api.js --port=7071 &')?.port, 7071);
  assert.equal(bash('PORT=7072 ./start.sh &')?.port, 7072);
  assert.equal(bash('./bin/api --port 7070'), null, 'in the foreground it ends with the call');
  for (const command of ['ssh -p 2222 host &', 'git log -p 20 &', 'npm test -- --port 9000 &', 'ssh -L 8080:localhost:80 host &', 'tail -n 20 -f log &', './bin/api -p 7070 &', 'sleep 5 -l 30 &']) {
    assert.equal(bash(command), null, command);
  }
  assert.equal(bash('ssh -p 2222 host', { run_in_background: true }), null);
});

test('a command to look first, and one that stops only the process the check saw', () => {
  assert.deepEqual(leftoverCommands(5173, { platform: 'darwin', pid: 42 }), { look: 'lsof -nP -iTCP:5173 -sTCP:LISTEN', kill: 'kill 42' });
  // Linux without lsof (/proc/net/tcp): no process id, so only a look that works there.
  assert.deepEqual(leftoverCommands(5173, { platform: 'linux', pid: null, lsof: false }), { look: "ss -ltnp 'sport = :5173'", kill: null });
  assert.deepEqual(leftoverCommands(8080, { platform: 'win32', pid: 7 }), { look: 'Get-NetTCPConnection -LocalPort 8080 -State Listen', kill: 'Stop-Process -Id 7' });
  assert.equal(leftoverCommands(8080, { platform: 'win32', pid: null }).kill, null);
});

test('leftovers from the server are read defensively', () => {
  assert.equal(readLeftovers(null), null);
  assert.equal(readLeftovers({ sessionId: 's1' }), null);
  const read = readLeftovers({ sessionId: 's1', at: 5, items: [{ command: 'npm run dev', port: 5173, pid: 9, look: 'lsof', kill: 'kill 9', sure: true }, { command: 'x', port: 'nope', look: 'y' }, null] });
  assert.deepEqual(read, { sessionId: 's1', at: 5, items: [{ command: 'npm run dev', port: 5173, pid: 9, look: 'lsof', kill: 'kill 9', sure: true }] });
  const unsure = readLeftovers({ sessionId: 's1', items: [{ command: 'a', port: 1, look: 'l', kill: 'kill 1' }] });
  assert.deepEqual([unsure?.items[0].pid, unsure?.items[0].kill, unsure?.items[0].sure], [null, null, false], 'no stop command for one not known to be the session\'s');
});
