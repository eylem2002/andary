# Fixes from the independent review of parts 28 and 29

Part 30 of 30 · base: `fix/product-polish` · merge last

A reviewer who had not seen parts 28–29 found **2 must-fix** problems, both in the new HTTPS
listener, 2 should-fix and 5 nits ([report](../reviews/hardening-review-2026-11-20.md)). All are
fixed here with tests.

## What changed

- **HTTPS with `--host <address>` works for this computer's own clients**: plain HTTP is accepted
  from a loopback peer or from a peer connecting from the address it connected to, so the
  forwarder, `status`, `stop` and the printed link work; `start` also prints an `https://` link for
  other computers.
- **Time limits and shutdown with TLS**: the inner HTTP and HTTPS servers now start their request
  time limits and connection tracking, the TLS handshake has a 10 s limit, a refused peer is
  disconnected after 2 s, and stopping ends every connection, stalled ones included.
- **A demo opened from a sign-in link** takes the token out of the address bar and keeps it, so
  "Leave the demo" lands signed in.
- **Approval diffs collapse blank-line padding** into "⟨N blank lines⟩" and say how many lines a
  change adds and removes.
- **Sign-in**: a token from a link is only kept once the server accepts it (a crafted link can no
  longer sign you out); the in-memory fallback works without storage; lab pages drop the token.
- **Lighthouse's lockfile** now pins the dependency versions that run reliably here
  (`puppeteer-core` 25.17.0: 25.18.1 lost the page with "Target closed"); `npm run perf` passes on
  desktop and mobile again.
- The forwarder's hard stop counts the proof round trip. Docs corrected; the final report and the
  pull request descriptions cover parts 28–30.

## Tests

858 unit and integration tests (850 before). New: who counts as this computer; a refused
network peer is disconnected by the server; stopping with four stalled connections (a lone TLS
byte, a silent socket, unfinished plain and TLS headers) takes under 1.5 s; `--host <address>`
with a certificate still receives the forwarder's events; candidate sign-ins kept or dropped by
the server's answer; the memory fallback; blank-line runs; lab pages lose the token.
