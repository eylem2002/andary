import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../../../scripts/scan-secrets.mjs';

// Real-looking values are assembled at runtime so this file never contains a literal secret.
const join = (/** @type {string[]} */ ...parts) => parts.join('');
const fakeGithub = join('gh', 'p_', 'R8t2x7Kq9Lm4Np6Vb3Zc1Hd5Jf0Gs8Wy2Qe7');
const fakeAws = join('AK', 'IA', 'Q7RT2VX9MK4LP3ZD');
const fakeAnthropic = join('sk-', 'ant-', 'api03-Q7xV9mR2kL5pW8nT3jH6fD1sA4gZ0cB');
const fakePassword = join('DB_PASS', 'WORD=', 'Zq8vN3kT6pW1xR4m');
const pemHeader = join('-----BEGIN ', 'RSA PRIVATE KEY-----');
const pemFooter = join('-----END ', 'RSA PRIVATE KEY-----');
const keyBody = 'MIIEowIBAAKCAQEA7Qe1nZb9Vd3xW2kLp8sR4tY6uHj0mNcA5fGhJkLzXcVbNm1Q2w3E4r5T6y7U8i9O0pAsDfGhJkL';

test('finds real-looking credentials and reports where', () => {
  const text = `line one\ntoken = "${fakeGithub}"\nkey=${fakeAws}\n${fakeAnthropic}\n${fakePassword}`;
  const findings = scanText(text, 'config.txt');
  assert.deepEqual(findings.map((f) => [f.rule, f.where]), [
    ['github-token', 'config.txt:2'],
    ['aws-access-key', 'config.txt:3'],
    ['anthropic-key', 'config.txt:4'],
    ['generic-assignment', 'config.txt:5'],
  ]);
});

test('never prints a whole secret', () => {
  const [finding] = scanText(fakeGithub, 'x');
  assert.ok(finding.snippet.length < 16);
  assert.ok(!finding.snippet.includes(fakeGithub));
});

test('ignores values that say they are fake', () => {
  assert.deepEqual(scanText('AKIAIOSFODNN7EXAMPLE', 'docs.md'), []);
  assert.deepEqual(scanText('API_KEY=your-api-key-goes-here-placeholder', 'README.md'), []);
  assert.deepEqual(scanText('const token = "sk-test-0000000000000000000000000000000000"', 't.js'), []);
});

test('reports a private key block with a body, on the line it starts', () => {
  const findings = scanText(`intro\n${pemHeader}\n${keyBody}\n${keyBody}\n${pemFooter}\n`, 'id_rsa');
  assert.deepEqual(findings.map((f) => [f.rule, f.where]), [['private-key', 'id_rsa:2']]);
});

test('reports a key pasted as a JSON string with \\n escapes', () => {
  const json = `{"private_key": "${pemHeader}\\n${keyBody}\\n${keyBody}\\n${pemFooter}\\n"}`;
  assert.deepEqual(scanText(json, 'sa.json').map((f) => f.rule), ['private-key']);
});

test('one fake key does not swallow the file up to the next key header', () => {
  const file = `a = \`${pemHeader}\\n\${fake(60)}\\n${pemFooter}\`;\n${'x = 1;\n'.repeat(20)}b = \`${pemHeader}\`;`;
  assert.deepEqual(scanText(file, 't.js'), []);
});

test('a key header without a body (a test building a fake key at runtime) is not a secret', () => {
  assert.deepEqual(scanText(`const pem = \`${pemHeader}\\n\${fake('MIIE', 60)}\\n${pemFooter}\`;`, 't.js'), []);
  assert.deepEqual(scanText(`docs mention ${pemHeader} blocks`, 'README.md'), []);
});
