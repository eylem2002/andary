// Runs cloudflared for the town and stops it when the town goes (ADR 0019): `node
// tunnel-watchdog.mjs <cloudflared> <args…>`. The town keeps this process's stdin open; when the
// town ends in any way, `kill -9` included, the operating system closes that pipe, and this stops
// cloudflared, so no tunnel outlives the town and publishes whatever takes its port next.
// cloudflared's output goes straight to the town. The first line this writes is its pid.
// Stands alone: Node built-ins only.
import { spawn } from 'node:child_process';

const [bin, ...args] = process.argv.slice(2);
const child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
child.once('error', (/** @type {NodeJS.ErrnoException} */ error) => {
  process.stderr.write(`andary-tunnel-error ${error.code ?? error.message}\n`);
  process.exit(127);
});
if (child.pid) process.stderr.write(`andary-tunnel-pid ${child.pid}\n`);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
};
process.stdin.once('end', stop);
process.stdin.once('close', stop);
process.stdin.on('error', stop);
process.stdin.resume();
process.on('SIGTERM', stop);
// Ctrl+C reaches cloudflared itself; this waits for the town to close the pipe.
process.on('SIGINT', () => {});
child.once('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
