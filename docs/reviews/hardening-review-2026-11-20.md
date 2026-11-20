# Review of the remaining-risk fixes (parts 28–29, 2026-11-20)

A reviewer who had not seen the work read the diff from `fix/codex-review` to `fix/product-polish`
on its own checkout, ran `npm run check:fast` (850 tests, all passing, the TLS tests included),
and reproduced each finding with a script, a raw socket or a browser. All findings are fixed on
`fix/hardening-review` (part 30), each with a test.

| # | Finding | Severity | Outcome |
|---|---------|----------|---------|
| 1 | With `--host <network address>` and a certificate, local clients reached the server at that address over plain HTTP, were not loopback peers, and got `400`: the forwarder sent nothing, `status` reported the server as gone, the printed sign-in link failed | must | Plain HTTP is accepted from this computer: a loopback peer or one connecting from the address it connected to; `start` also prints an `https://` link for other computers; the test checks the event arrives |
| 2 | With TLS on, the inner servers never heard they were listening, so request time limits and connection tracking were off: stalled connections stayed open, `stop()` could hang for minutes, a refused peer stayed connected | must | The listener tells both servers they are listening, sets a 10 s handshake limit, closes refused sockets after 2 s, and tracks every raw socket so stopping ends them all; a test stops in under 1.5 s with four stalled connections |
| 3 | A demo opened from a sign-in link (`andary demo`, `/town demo`) never read the fragment: the token stayed in the address bar and "Leave the demo" landed on Sign in | should | Every boot takes the sign-in out of the address first |
| 4 | The approval diff did not collapse blank-line padding: a Write with 200 blank lines could keep its payload below the card's fold | should | Three or more blank lines show as one "⟨N blank lines⟩" row; the note gives line counts |
| 5 | Without storage the in-memory fallback never ran, so the token was lost after one read | nit | Fixed; tested |
| 6 | Any page could sign you out by linking to `#signin=junk` | nit | A token from a link is a candidate until `/api/hello` accepts it; tested |
| 7 | Lab pages kept a sign-in token in their address | nit | Their redirect drops the token instead |
| 8 | Docs that no longer matched (ASSUMPTIONS 57, CONTRACTS, ADR 0016, the final report's `bin/`) | nit | Fixed |
| 9 | The forwarder's hard stop did not count the proof round trip | nit | It does |

Checked and found sound: no cookie is set or read; the server confirms only the `andary`
subprotocol, never the token; fetches and the socket go to the page's own origin; CSRF is
impossible with custom headers; a viewer cannot become the owner. The proof cannot stand in for a
signed reply or the other way round, and nothing is sent before it. Deny reasons are cleaned on
the server and shown as text only; A and D do nothing while typing or reading the diff. IPv4-mapped
loopback is handled. The CI hashes match the published values. The CLI move left no live `bin/`
reference and `npm pack` works. The boot plays the store's backlog or syncs (never both), capped at
5,000 changes. `env/` and `agents/` still meet only through a callback. The Windows test skips are
reasonable and only Windows may fail without failing CI.
