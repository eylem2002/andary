// Runs the hook forwarder the way Claude Code does (payload on stdin, decision on stdout).
// Used by `andary doctor` and by the test helpers.
import { spawn } from 'node:child_process';
import { HOOK_SOURCE } from './config.mjs';

/**
 * @param {{ payload: unknown, script?: string, env?: NodeJS.ProcessEnv, input?: string, timeoutMs?: number }} options
 *   `input` overrides the stdin text (to send something that is not JSON).
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string }>}
 */
export function runHookScript({ payload, script = HOOK_SOURCE, env = process.env, input, timeoutMs = 10_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    // The forwarder may exit before reading stdin (no server): ignore the broken pipe.
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? JSON.stringify(payload));
  });
}
