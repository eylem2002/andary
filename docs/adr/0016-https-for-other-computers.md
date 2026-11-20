# 0016 — HTTPS for other computers, plain HTTP on loopback, one port

Status: Accepted

## Context

A team town (`--team`) and `--host` make the server reachable from other computers. Over plain
HTTP, member keys, events (prompts, commands, file paths) and the view link cross the network in
clear. Most people can get a free certificate for a name their teammates use (`tailscale cert`
on Tailscale, or a certificate from their own CA). Andary has no runtime dependencies and must
keep working with no certificate at all.

The hook forwarder, the CLI and a local browser talk to the server over `127.0.0.1`. That
traffic never leaves the computer, and a certificate issued for a network name would not match
`127.0.0.1` anyway.

## Decision

- `andary start --tls-cert <file> --tls-key <file>` (or `ANDARY_TLS_CERT` / `ANDARY_TLS_KEY`)
  serves HTTPS with that certificate (TLS 1.2 or newer). The files are read and checked at start
  (a key that does not fit fails at once).
- One port takes both: the first byte of a connection decides. `0x16` (a TLS handshake) goes to
  the HTTPS server; anything else is plain HTTP, accepted only from this computer (a loopback
  peer, or one connecting from the very address it connected to, which is how a local client of
  `--host <address>` arrives) and answered `400` ("only answers over https://") from anywhere
  else, then closed. Nothing reaches the network in clear.
- Local clients are unchanged: they use plain HTTP at the address the server listens on
  (`127.0.0.1` for a wildcard bind). `server.json` records `tls: true` and a team host's
  `--team-host` names, so `andary team invite` prints `https://<first name>:<port>`; `start`
  prints an `https://` sign-in link for other computers.
- The inner HTTP and HTTPS servers never listen themselves, so the listener tells them they are
  listening (which starts Node's request time limits and connection tracking), sets a 10 s TLS
  handshake limit, and tracks every raw socket so stopping the server ends all of them.
- WebSocket `Origin` checks accept `https://` origins with an allowed host.
- Without a certificate nothing changes, and the CLI's warning now says how to add one.

## Consequences

- Encryption needs a certificate the teammates' Andary (Node) and browsers trust; a self-signed
  one works with `NODE_EXTRA_CA_CERTS` and a browser exception, but a real one is easier.
- The sign-in, member keys and view link are unchanged; HTTPS protects them in transit.
- The TLS path replays the handshake's first bytes through a small stream (TLS reads a socket's
  handle directly), so `req.socket.remoteAddress` is not available on HTTPS requests; nothing
  uses it there.
