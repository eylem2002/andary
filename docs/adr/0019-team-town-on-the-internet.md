# 0019 — A team town on the internet through a Cloudflare Quick Tunnel

Status: Accepted

## Context

A team town (`--team`) reaches teammates on the same network, or across the internet through a
private network such as Tailscale (ADR 0016). Teammates in other places often have neither, and
the host may have no domain, no certificate and no way to open a port. Cloudflare's Quick Tunnels
(`cloudflared tunnel --url http://127.0.0.1:<port>`) give a random
`https://<words>.trycloudflare.com` address with no account: cloudflared, running on the host,
connects out to Cloudflare, and Cloudflare forwards requests (WebSockets included) to the local
port. They are for testing: no uptime guarantee, at most 200 requests in flight, the address
changes every time, and they do not start while `~/.cloudflared/config.yml` exists. cloudflared
2026.9.3 added `--allowed-mail`, which asks visitors for an emailed code in their browser.

This is a lasting change: the town becomes reachable by anyone on the internet who has, or
guesses, the address. Every request arrives from cloudflared on this computer, so its socket is
loopback: "where the connection came from" can no longer tell this computer from the internet.

## Decision

- `andary start --team --tunnel` runs the `cloudflared` found on the PATH (absolute PATH entries
  only; `cloudflared.exe` on Windows). Andary never downloads or installs it; when it is missing
  the start fails with how to install it. cloudflared gets Andary's environment without
  `ANDARY_*` and `TUNNEL_*` variables, and the start refuses while a `config.yml`/`config.yaml`
  is in any folder cloudflared reads one from. Andary reads the address from cloudflared's
  output (30 s limit, then a clear error with cloudflared's last lines), records it in
  `server.json` (`tunnel: { url, pid, port }`), and stops cloudflared before the server. The
  address is not kept: a restart gets a new one, and the CLI says so.
- **No tunnel outlives its town.** cloudflared runs under a small watchdog
  (`server/tunnel-watchdog.mjs`, a Node process) whose stdin the town holds open. However the
  town ends, `kill -9` included, the operating system closes that pipe, and the watchdog stops
  cloudflared (SIGTERM, then SIGKILL). Otherwise the old public name would keep pointing at a
  port that is now free, and whatever took it next would be on the internet. As a second line of
  defence, `andary start` and `andary doctor` check a `server.json` whose town is gone. If its
  `tunnel.pid` is alive and its command line (from `/proc`, `ps`, or CIM on Windows) is
  cloudflared for that `tunnel.port`, they stop it and say so. If that cannot be confirmed, they
  warn with the pid and leave it alone.
- **A port of its own.** The tunnel points at a second, plain-HTTP listener on `127.0.0.1` with a
  random port, opened only for it. Every request on it is marked as tunnelled whatever its socket
  says. On any port, a request carrying Cloudflare's edge headers (`Cf-Connecting-IP`, `Cf-Ray`,
  `Cf-Visitor`, `Cf-IPCountry`, or `CDN-Loop: cloudflare`, which clients cannot remove) is
  tunnelled too, in case a tunnel is pointed at the town's own port.
- **A tunnelled request is never the owner.** The UI token is ignored (`browserRole`), the
  sign-in link answers 403, `/api/proof`, `/api/hook` and `/api/limits` answer 403 whatever they
  carry, and `/api/hello` hides the owner's approval and notification settings, and also the version
  and approval timeout unless the request carries the view token or a member key. What remains is
  what a teammate on the network can do: watch with the view token, post events with a member
  key (`/api/team`, its rate limits unchanged), the static app (public code, the same as the
  hosted demo) and `/api/health`.
- **Host and Origin stay strict.** A tunnelled request must name the tunnel's exact host (no
  port, or 443) as `Host`; a tunnelled WebSocket must send `Origin: https://<that host>` (none,
  or `http://`, is refused). Before the address is known nothing is accepted. `/api/team` keeps its exception from the Host check on the network only.
- With `--tunnel` the town itself listens on `127.0.0.1` (not every interface) unless `--host`
  says otherwise: teammates come through the tunnel. The CLI warns that the town is on the
  internet, protected by the links, and that `andary team reset` revokes them.
  `andary team invite` prints the tunnel's address in the `--share-to` line and the view link;
  `andary doctor` reports whether the tunnel is up (from `server.json`, without connecting to it).
- `--tunnel-allowed-mail <emails>` passes `--allowed-mail` for each address, only after checking
  that the installed cloudflared lists the flag. Email sign-in needs a browser, so teammates can
  then watch but their Andary cannot share; the CLI says so.

## Consequences

- No account, domain or VPN: one flag and a program from Cloudflare. Traffic is HTTPS between
  teammates and Cloudflare; Cloudflare sees it in clear (it terminates TLS), which the README
  states. Teammates' Andary posts to an `https://` address like any other (`--share-to`).
- The links' secrecy is the whole protection: a member key lets anyone add sessions as that
  member, and the view link shows everyone's prompts and commands. Reset revokes both.
- The owner never uses the tunnel; their own browser stays on `127.0.0.1`.
- Restarting the tunnel when cloudflared stops is out of scope: the town logs it, `server.json`
  records it as down, the doctor reports it, and a restart gives a new address.
- A reverse proxy that is not Cloudflare and adds no Cloudflare headers is not recognised; such a
  set-up is not supported (the README's advice is TLS or a private network, ADR 0016).
