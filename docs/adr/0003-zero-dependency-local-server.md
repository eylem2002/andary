# 0003 — A zero-dependency Node server bound to loopback

Status: Accepted

## Context

The server only needs static files, one JSON endpoint for hooks and a WebSocket feed. Every
runtime dependency is supply-chain risk on a machine that also runs an AI coding agent with
access to the user's code.

## Decision

Implement the server with Node built-ins only (`node:http`, `node:crypto`, `node:zlib`,
`node:fs`), including a minimal RFC 6455 WebSocket server (text frames, ping/pong, close,
masking, size limits) covered by unit tests. Bind to `127.0.0.1` by default; binding elsewhere
requires an explicit flag and prints a warning.

## Consequences

- `npm install` is not needed to run Andary; `npm audit` covers dev tooling only.
- The WebSocket implementation is ours to maintain; it supports only what the app uses
  (no extensions, no binary frames).
