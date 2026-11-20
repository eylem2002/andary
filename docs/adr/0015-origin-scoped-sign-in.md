# 0015 — Sign-in kept per origin, not in a cookie

Status: Accepted (replaces the cookie in ADR 0004)

## Context

ADR 0004 traded the sign-in link's UI token for an `HttpOnly; SameSite=Strict` cookie. Browsers
scope cookies by host, not by port, so the cookie for `127.0.0.1` is also sent to every other
port on `127.0.0.1`. On a shared computer, a web server another user runs on loopback receives
it as soon as you open that server's page in the same browser, and with it can read your town and
answer your agents' permission prompts. `SameSite` does not help: a page on another port of the
same host is the same site.

## Decision

- The sign-in link (`/?token=…`) is checked by the server and redirected to the same page with
  the token in the fragment (`#signin=…`); a team viewer's link becomes `#view=…`. A fragment is
  never sent to a server again, so the token appears in no later request line or `Referer`.
- The page moves it into `localStorage` (key `andary:signin`) at once and takes it out of the
  address bar. Page storage belongs to one origin, port included: no other local server can read
  it, and every tab of the same town shares it (signing in again after a restart, in any tab,
  signs in all of them).
- Requests carry it explicitly: `x-andary-token` (or `x-andary-view`) on `fetch`, and on the
  WebSocket, which cannot set headers, the subprotocols `andary` and `andary.token.<token>`
  (`andary.view.<token>`). The server confirms `andary` only.
- The server sets no cookie and reads none. The `Host` and `Origin` checks and everything else in
  ADR 0004 stay.

## Consequences

- Nothing is sent automatically, so cross-site requests carry no credentials at all; a custom
  header also needs a CORS preflight that the server never grants.
- A script running in the town's own page could read the token, which an `HttpOnly` cookie hid.
  The page runs only its own scripts (`script-src 'self'` plus one hashed inline script, no
  third-party code) and never renders event text as HTML (a lint rule bans the sinks), so there
  is no way for content to run script there.
- The token survives a browser restart (until the server restarts and makes a new one), like a
  remembered sign-in.
