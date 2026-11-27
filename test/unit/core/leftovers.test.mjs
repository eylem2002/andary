import { test } from 'node:test';
import assert from 'node:assert/strict';
import { killCommand, readLeftovers, serverStart } from '../../../public/js/core/leftovers.js';

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

test('anything in the background that names a port counts', () => {
  assert.equal(bash('./bin/api --port 7070 &')?.port, 7070);
  assert.equal(bash('./bin/api --port 7070'), null, 'in the foreground it ends with the call');
});

test('the command to copy finds the process by its port when it runs, never by an old id', () => {
  assert.equal(killCommand(5173), 'kill $(lsof -t -iTCP:5173 -sTCP:LISTEN)');
  assert.equal(killCommand(5173, { platform: 'darwin', pid: 42 }), 'kill $(lsof -t -iTCP:5173 -sTCP:LISTEN)');
  assert.equal(killCommand(5173, { platform: 'linux', pid: 42, lsof: false }), 'kill 42');
  assert.equal(killCommand(8080, { platform: 'win32', pid: 7 }), 'Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess');
});

test('leftovers from the server are read defensively', () => {
  assert.equal(readLeftovers(null), null);
  assert.equal(readLeftovers({ sessionId: 's1' }), null);
  const read = readLeftovers({ sessionId: 's1', at: 5, items: [{ command: 'npm run dev', port: 5173, pid: 9, kill: 'kill 9' }, { command: 'x', port: 'nope', kill: 'y' }, null] });
  assert.deepEqual(read, { sessionId: 's1', at: 5, items: [{ command: 'npm run dev', port: 5173, pid: 9, kill: 'kill 9' }] });
  assert.equal(readLeftovers({ sessionId: 's1', items: [{ command: 'a', port: 1, kill: 'k' }] })?.items[0].pid, null);
});
