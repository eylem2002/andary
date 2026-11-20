# Security: sign-in per origin, full changes on approval cards, a forwarder challenge, HTTPS

Part 28 of 30 · base: `fix/codex-review`

Fixes the security items left on the final report's list.

## What changed

- **The sign-in is no longer a cookie** (ADR 0015). Browsers send a cookie for `127.0.0.1` to
  every port on it, so another local web server you opened in the same browser received your
  town's sign-in. The sign-in link now hands the token to the page in the URL fragment; the page
  keeps it in its own storage (one origin, port included), removes it from the address bar and
  sends it with each request: `x-andary-token` on `fetch`, the subprotocol `andary.token.<token>`
  on the WebSocket. The server sets and reads no cookie. Team view links work the same way.
- **Approval cards show a file change in full**: a Write's content, an Edit's or MultiEdit's
  diff, a notebook cell's new source, with hidden characters revealed. Nothing is approved
  unseen.
- **A denial can say why**: an optional reason field on each card (Enter denies); the agent reads
  `Denied from Andary: <reason>`. Typing there never answers the card by itself.
- **The forwarder makes the server prove itself first.** `GET /api/proof` answers a nonce with
  `HMAC(responseKey, "andary-proof\n" + nonce)`; until then the forwarder sends nothing, not even
  the hook secret. A recycled pid of a dead server whose port someone else holds learns nothing.
- **HTTPS for other computers** (ADR 0016): `andary start --tls-cert <file> --tls-key <file>`.
  One port speaks HTTPS to the network and refuses plain HTTP from it; this computer's own
  clients keep plain HTTP on `127.0.0.1`. Invites and view links print `https://` at the first
  `--team-host` name. The README shows it with `tailscale cert`.
- **Dev tooling pinned by hash**: CI checks actionlint's archive against its published sha256
  and installs yamllint with `pip --require-hashes`; Lighthouse has its own lockfile in
  `tools/lighthouse` (ADR 0011).

## Tests

838 unit and integration tests (822 before). New: the credentials module and the live link's
headers and subprotocols; server checks that a cookie no longer signs in and that the
subprotocol is confirmed; the change model and reason cleaning; an impostor with a live pid
receives only the challenge; HTTPS, `wss://` sign-in, plain HTTP refused from the network and
kept on loopback (with a throwaway openssl certificate); TLS option parsing. End to end: a page
on another port is not signed in while a second tab on the town is; an Edit card shows a diff
with a revealed bidi character and a reason typed key by key; axe on an edit card (desktop and
phone).
