// Runs in Claude Code's own mod engine: `claude plugin test mods/andary-limits` (Claude Code v2.1.287+).
// The repository's node:test suite (test/unit/mods/) covers the same module in Node; this one checks
// it against the real sandbox, whose crypto.subtle has digest() only.
import { expect, test } from 'claude-code/testing'

const KEY = 'response-key-for-the-test'
const enc = new TextEncoder()
function b64url(bytes: Uint8Array) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
// The server's proof for the mod's random nonce, from digests (the test sandbox has no HMAC either):
async function h(b: Uint8Array) { return new Uint8Array(await crypto.subtle.digest('SHA-256', b)) }
async function proofFor(nonce: string) {
  const k = enc.encode(KEY), m = enc.encode('andary-proof\n' + nonce)
  const i = new Uint8Array(64 + m.length), o = new Uint8Array(96)
  for (let j = 0; j < 64; j++) { i[j] = (k[j] ?? 0) ^ 0x36; o[j] = (k[j] ?? 0) ^ 0x5c }
  i.set(m, 64); o.set(await h(i), 64)
  return b64url(await h(o))
}

test('a measure sends the limits to Andary through the real engine', async ($, on) => {
  const calls: any[] = []
  let posted: (v: any) => void = () => {}
  const post = new Promise((r) => { posted = r })
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : e.name === 'CLAUDE_CONFIG_DIR' ? '/home/u/.claude-work' : undefined }))
  on('fs.read', ($, e) => { calls.push(['read', e.path]); return { value: JSON.stringify({ pid: 1, port: 4747, host: '127.0.0.1', secret: 'S', responseKey: KEY }) } })
  on('http.fetch', async ($, e) => {
    calls.push(['fetch', e.url, e.init])
    if (e.url.endsWith('/api/proof')) return { value: { status: 200, ok: true, headers: { 'x-andary-proof': await proofFor(e.init.headers['x-andary-nonce']) }, text: '{"ok":true}' } }
    posted(e)
    return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
  })
  on('session.usage', () => ({ value: { startedAt: '2026-11-21T10:00:00.000Z', context: { tokens: 182340, window: 1000000, percent: 18 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-21T15:40:00.000Z' }], cost: { usd: 1 } } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.version', () => ({ value: { version: '2.1.330' } }))
  on('session.measure', () => ({ changed: ['rateLimits'] }))
  const out = await $.session.measure({ context: { tokens: 182340, window: 1000000, percent: 18 }, rateLimits: [], cost: { usd: 1 }, changed: ['rateLimits'] })
  expect(out).toEqual({ changed: ['rateLimits'] })
  const e: any = await post
  expect(e.url).toBe('http://127.0.0.1:4747/api/limits')
  expect(e.init.headers['x-andary-secret']).toBe('S')
  expect(JSON.parse(e.init.body)).toEqual({ v: 1, sessionId: 'sess-1', claudeVersion: '2.1.330', configDir: '/home/u/.claude-work', limits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-21T15:40:00.000Z' }], context: { tokens: 182340, window: 1000000 } })
  expect(calls[0]).toEqual(['read', '/home/u/.andary/server.json'])
})

test('a wrong proof sends nothing, and no Andary breaks nothing', async ($, on) => {
  const urls: string[] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', () => ({ value: JSON.stringify({ pid: 1, port: 4747, secret: 'S', responseKey: KEY }) }))
  on('http.fetch', ($, e) => { urls.push(e.url); return { value: { status: 200, ok: true, headers: { 'x-andary-proof': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, text: '' } } })
  on('session.usage', () => ({ value: { context: { window: 1 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.measure', () => ({ changed: ['context'] }))
  await $.session.measure({ context: { window: 1 }, rateLimits: [], cost: { usd: 0 }, changed: ['context'] })
  await new Promise((r) => setTimeout(r, 200))
  expect(urls).toEqual(['http://127.0.0.1:4747/api/proof'])
})
