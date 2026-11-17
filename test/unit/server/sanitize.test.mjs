import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_KEY_CHARS, MAX_OBJECT_KEYS, MORE_KEYS,
  DEPTH_PLACEHOLDER,
  MAX_ARRAY_ITEMS,
  MAX_DEPTH,
  MAX_STRING_CHARS,
  REDACTED,
  SECRET_PATTERNS,
  redactSecrets,
  sanitize,
  truncateString,
} from '../../../server/sanitize.mjs';

// Built at runtime so this file never contains a string that secret scanners flag.
const fake = (/** @type {string} */ prefix, length = 36, alphabet = 'aB3dE5gH7jK9mN1pQ2') =>
  prefix + Array.from({ length }, (_, i) => alphabet[i % alphabet.length]).join('');

/** Every pattern with an input it must catch and the part that must disappear. */
const SAMPLES = {
  'private-key': {
    input: `key:\n-----BEGIN RSA PRIVATE KEY-----\n${fake('MIIEow', 60)}\n-----END RSA PRIVATE KEY-----\nafter`,
    secret: fake('MIIEow', 60),
    kept: 'after',
  },
  'sk-key': { input: `export X=1; curl -H "x-api-key: ${fake('sk-ant-api03-')}"`, secret: fake('sk-ant-api03-') },
  'stripe-key': { input: `stripe ${fake('sk_live_', 24)}`, secret: fake('sk_live_', 24) },
  'github-token': { input: `git push https://${fake('ghp_')}@github.com/o/r`, secret: fake('ghp_') },
  'github-pat': { input: `token ${fake('github_pat_', 40)}`, secret: fake('github_pat_', 40) },
  'slack-token': { input: `SLACK ${fake('xoxb-1234-', 20)}`, secret: fake('xoxb-1234-', 20) },
  'aws-access-key': { input: 'aws AKIA' + 'ABCDEFGHIJKLMNOP is set', secret: 'AKIA' + 'ABCDEFGHIJKLMNOP' },
  'google-api-key': { input: `maps ${fake('AIza', 35)} end`, secret: fake('AIza', 35) },
  'npm-token': { input: `//registry.npmjs.org/:_authToken ${fake('npm_', 36)}`, secret: fake('npm_', 36) },
  jwt: {
    input: `cookie ${fake('eyJ', 20)}.${fake('eyJ', 20)}.${fake('sig', 20)}`,
    secret: `${fake('eyJ', 20)}.${fake('eyJ', 20)}`,
  },
  bearer: { input: `curl -H "Authorization: Bearer ${fake('tok', 30)}"`, secret: fake('tok', 30), kept: 'Bearer [redacted]' },
  'basic-auth': { input: `Authorization: Basic ${fake('dXNlcjpw', 16)}`, secret: fake('dXNlcjpw', 16) },
  'url-credentials': { input: 'git clone https://me:hunter2-secret@example.com/repo.git', secret: 'hunter2-secret', kept: 'https://me:[redacted]@example.com' },
  'named-assignment': { input: 'OPENAI_API_KEY=abc123 DB_PASSWORD="p a s s" npm start --token=xyz', secret: 'abc123', kept: 'npm start' },
  'json-field': { input: '{"apiKey": "live-value-123", "name": "town"}', secret: 'live-value-123', kept: '"name": "town"' },
};

describe('redactSecrets', () => {
  it('has a sample for every pattern', () => {
    assert.deepEqual(Object.keys(SAMPLES).sort(), SECRET_PATTERNS.map((p) => p.name).sort());
  });

  for (const [name, { input, secret, kept }] of Object.entries(SAMPLES)) {
    it(`redacts ${name}`, () => {
      const out = redactSecrets(input);
      assert.ok(!out.includes(secret), `${name} still visible in: ${out}`);
      assert.ok(out.includes(REDACTED), `${name}: no marker in: ${out}`);
      if (kept) assert.ok(out.includes(kept), `${name}: lost "${kept}" in: ${out}`);
    });
  }

  it('redacts every NAME=value assignment, keeping the names', () => {
    const out = redactSecrets('OPENAI_API_KEY=abc123 DB_PASSWORD="p a s s" --token=xyz MY_SECRET=s3');
    assert.equal(out, `OPENAI_API_KEY=${REDACTED} DB_PASSWORD=${REDACTED} --token=${REDACTED} MY_SECRET=${REDACTED}`);
  });

  it('redacts PEM blocks whose END line was cut off', () => {
    const out = redactSecrets(`-----BEGIN OPENSSH PRIVATE KEY-----\n${fake('b3Blbn', 80)}`);
    assert.equal(out, REDACTED);
  });

  it('leaves ordinary text alone', () => {
    const text = 'Read src/auth/login.ts, ran npm test (12 passed), risk-assessment done; PWD=/home/me; a == b';
    assert.equal(redactSecrets(text), text);
  });

  it('stays fast on hostile input', () => {
    const hostile = ['a-'.repeat(200_000), 'key="'.repeat(50_000), 'x://'.repeat(100_000), '"key":"'.repeat(50_000)];
    for (const text of hostile) {
      const started = performance.now();
      redactSecrets(text);
      assert.ok(performance.now() - started < 1500, `took too long on ${text.slice(0, 12)}…`);
    }
  });
});

describe('truncateString', () => {
  it('keeps short strings and cuts long ones with a count', () => {
    assert.equal(truncateString('short'), 'short');
    const long = 'a'.repeat(MAX_STRING_CHARS + 25);
    assert.equal(truncateString(long), `${'a'.repeat(MAX_STRING_CHARS)}…[+25 chars]`);
    assert.equal(truncateString('a'.repeat(MAX_STRING_CHARS)), 'a'.repeat(MAX_STRING_CHARS));
  });

  it('never splits a surrogate pair', () => {
    const text = `${'a'.repeat(MAX_STRING_CHARS - 1)}😀tail`;
    const out = truncateString(text);
    assert.ok(out.startsWith(`${'a'.repeat(MAX_STRING_CHARS - 1)}…`));
    assert.ok(out.endsWith('[+6 chars]'));
  });
});

describe('sanitize', () => {
  it('cuts strings, arrays and depth to the contract limits', () => {
    const deep = /** @type {any} */ ({});
    let cursor = deep;
    for (let i = 0; i < MAX_DEPTH + 3; i += 1) cursor = cursor.next = {};
    const out = sanitize({
      text: 'z'.repeat(MAX_STRING_CHARS + 1),
      list: Array.from({ length: 80 }, (_, i) => i),
      deep,
    });
    assert.equal(out.text.length, MAX_STRING_CHARS + '…[+1 chars]'.length);
    assert.equal(out.list.length, MAX_ARRAY_ITEMS);
    let level = out;
    let depth = 0;
    while (typeof level === 'object') {
      level = level.deep ?? level.next;
      depth += 1;
    }
    assert.equal(level, DEPTH_PLACEHOLDER);
    assert.equal(depth, MAX_DEPTH);
  });

  it('redacts before truncating, so a secret across the cut is still caught', () => {
    const secret = fake('ghp_');
    const out = sanitize({ command: `${'a'.repeat(MAX_STRING_CHARS - 10)} ${secret}` });
    assert.ok(!out.command.includes(secret.slice(0, 10)));
  });

  it('redacts string values of credential-like keys', () => {
    const out = sanitize({ tool_input: { api_key: 'abc', password: 'p', Authorization: 'x', totalTokens: 1234, token_count: 5, name: 'ok' } });
    assert.deepEqual(out.tool_input, { api_key: REDACTED, password: REDACTED, Authorization: REDACTED, totalTokens: 1234, token_count: 5, name: 'ok' });
  });

  it('does not modify its input and keeps __proto__ keys as plain data', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "list": [1, 2]}');
    const out = sanitize(input);
    assert.equal(Object.getPrototypeOf(out), Object.prototype);
    assert.equal(/** @type {any} */ ({}).polluted, undefined);
    assert.deepEqual(Object.keys(out), ['__proto__', 'list']);
    assert.deepEqual(input.list, [1, 2]);
  });

  it('passes numbers, booleans and null through', () => {
    assert.deepEqual(sanitize({ a: 1, b: false, c: null, d: [true, 2.5] }), { a: 1, b: false, c: null, d: [true, 2.5] });
  });
});

describe('object keys', () => {
  it('shortens long keys, redacts secrets in keys and caps the number of keys', () => {
    const wide = Object.fromEntries(Array.from({ length: MAX_OBJECT_KEYS + 25 }, (_, i) => [`k${i}`, i]));
    const out = sanitize({ ['x'.repeat(900_000)]: 1, [fake('sk-ant-api03-', 30)]: true, wide });
    const keys = Object.keys(out);
    assert.ok(keys[0].length < MAX_KEY_CHARS + 30, `key kept ${keys[0].length} chars`);
    assert.equal(keys[1], REDACTED);
    assert.equal(Object.keys(out.wide).length, MAX_OBJECT_KEYS + 1);
    assert.equal(out.wide[MORE_KEYS], '[+25 keys]');
    assert.equal(out.wide.k99, 99);
    assert.equal(out.wide.k100, undefined);
  });
});
