# 0020 — People of a team town: a roster, personal links and enumerated profiles

Status: Accepted

## Context

A team town showed everyone's crews, but the people behind them were only a name on a Foreman.
The owner wanted each teammate to be someone in the town: a character they dress up themselves
("hair and everything, even the clothes"), in their own colour, with a home in the shared town.
That needs to know who a browser is, which until now was the owner or an anonymous viewer, and to
put text and choices from one person on everyone's screen.

Options considered:

- **Reuse the member key in the browser.** One credential, but a leaked key would then drive a
  character and a leaked link would post events; and the key lives in a shell environment, not
  in a link.
- **A name typed in the browser.** Nothing proves it; anyone with the view link could be anyone.
- **Free-form looks** (any colour, any text). Unbounded payloads and colours that fail contrast.
- **A separate personal link per person, checked against a roster, and a fixed, enumerated
  profile** (chosen).

## Decision

- Each person has a personal link: `name.HMAC(secret, "person:"+name)`, signed like the member
  key but for another purpose, so neither works as the other. The name comes from the token, never
  from a message.
- The host keeps a roster, `people.json` (0600): the host and at most five teammates, each with
  a home slot, a colour no one else has, and a profile. A member key or personal link works only
  while its name is on it, so `andary team remove` revokes one person at once; `team reset` still
  revokes everyone.
- A browser is the owner, a person or a viewer. A person may send only its own `profile` and
  `ping`; everything else is refused as for a viewer.
- A profile is version 1: every value is one of a fixed list or an index into a fixed palette,
  every key is required, unknown keys and anything over 512 bytes reject the whole profile. The
  same pure module (`core/profile.js`) checks it on the host and draws it in every browser.
- The homes are a residential quarter of their own, south of the ring road, doors facing south
  like every other door (assumption 230), rather than squeezed onto the west strip facing east.

## Consequences

- A leaked personal link lets someone change that person's character and watch the town, nothing
  more; removing the person ends it.
- Everyone renders the same look, and no free text from a teammate reaches another screen.
- Existing teams must invite their members again once (`team invite` prints the same key), since
  a key now needs its name on the roster.
- Presence (walking, emotes, lights from relays) and the person playing their own crew's lead
  come later, on top of this roster and these links.
