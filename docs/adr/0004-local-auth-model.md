# 0004 — Local authentication: UI token cookie, hook secret, Host and Origin checks

Status: Accepted

## Context

"Localhost only" is not a security boundary on its own:

- any web page the user visits can send requests to `127.0.0.1` (CSRF) and open WebSockets to it
  (cross-site WebSocket hijacking);
- DNS rebinding lets a malicious domain resolve to `127.0.0.1` and read responses;
- other accounts on a shared machine can connect to loopback ports.

The event stream contains prompts, commands and file paths, and remote approvals can let a
command run, so both reading and writing must be protected.

## Decision

- Each server start generates two 256-bit random values: a **hook secret** (sent by the
  forwarder in `x-andary-secret`) and a **UI token** (in the login URL printed by the CLI).
  Both live in `~/.andary/server.json` with mode 0600, readable only by the owner.
- `GET /?token=…` exchanges the UI token for an `HttpOnly; SameSite=Strict` cookie and redirects
  to a URL without the token. The WebSocket requires that cookie.
- Every request must carry a `Host` of `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`
  (defeats DNS rebinding). WebSocket upgrades must also have a matching `Origin` (defeats
  cross-site hijacking). Secrets are compared in constant time.
- Strict CSP and the usual hardening headers; the UI never renders event text as HTML.

## Consequences

- Opening the town needs the URL printed by `andary start` (the CLI opens it automatically).
- A restart invalidates old tabs; they show a sign-in hint.
