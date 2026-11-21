# What to build next: a review of Andary, and what GTA VI can teach it (2026-11-21)

The owner asked two things: what Andary still needs, and what it could borrow from how Grand Theft
Auto VI is designed. GTA VI came out on 19 November 2026 (PS5 and Xbox Series X|S). A research
agent read Rockstar's own pages and the reviews and previews listed at the end; GTA V is used where
VI coverage is thin, and says so. Everything here is a proposal. Nothing in it is built yet unless
it says so.

## What the town does badly today

Seen on the demo at 1440×900 and on a phone (412×915), after the place-label fix (ADR 0017):

1. **Speech bubbles pile up.** Achievements, "One more down!", "The team is on it…" and status
   lines stack five or six deep over the plaza, the busiest spot in town. They hide the agents
   more than the building labels ever did.
2. **Toasts sit over the middle of the town.** "New crew in docs-site", "New crew in web-app":
   two cards across the top centre, where the town is.
3. **On a phone the town is a postage stamp.** You cannot tell who is where.
4. **Nothing tells you, outside the Approvals tab, that the town is waiting for you.** The page
   title does not change, and a crew whose tests keep failing looks like any other crew.
5. **You see where an agent is, never where it is going,** until it gets there.
6. **Finished work goes by quietly.** A completed task is one log line.

## What GTA VI does that fits

The game's design keeps the screen quiet and shows things when they matter. Its navigation can
hide the minimap until you need it, a compass shows places only as you get close, and police show
up as one search area instead of a dot for every car. That is the same principle as the label fix:
icons, not text, and get out of the way of the action.

| # | GTA idea | What it would be in Andary | Size | Helps with |
|---|----------|----------------------------|------|------------|
| 1 | **Minimap with blips** (VI) | A small map in a corner: building icons, agents as dots in their crew colour, a wedge for where the camera looks; click to fly there. Redrawn a few times a second on a 2D canvas, no second 3D render. Shapes as well as colours. | medium | 3, 5 |
| 2 | **Wanted level, read as "needs you"** (VI) | Stars per crew: filled and pulsing for approvals waiting on you, outlined for failures that are not blocking (tests, exit codes), with a small icon for why. Click goes to the approval. The tab title becomes "(2) Andary" while approvals wait. | small–medium | 4 |
| 3 | **Phone, social feed and news** (VI) | A "town feed" that takes what the bubbles say now: short posts made from events ("Hall: the lead spawned 4 helpers", "Tests green after 3 tries"), merged and rate-limited. Bubbles over heads are kept for the crew you follow and what an agent says to you. | small–medium | 1 |
| 4 | **Area name on arrival** (V) | When the agent you follow reaches a building, a corner caption for two seconds: "Workshop · editing src/auth.ts". The director camera already captions its shots; this extends it to following. | small | 5 |
| 5 | **GPS route line** (VI) | A dashed line in the crew's colour on the ground from the selected agent to where it is walking, fading on arrival; also on the minimap. Only for the selected crew, so lines never tangle. | small–medium | 5 |
| 6 | **"Mission passed" banner** (V; VI keeps its result screens) | A short banner when a task completes, with a stats strip (time, tool calls, files touched, cost). Queued, dismissed by itself, never over Approvals, quiet with sound off. | small | 6 |
| 7 | **Character switch wheel** (V, VI) | Hold Tab: a wheel of crews (lead, colour, working/idle/waiting; ended crews greyed). Release: the camera lifts and swoops to that crew (a cut with reduced motion). 1–9 still work. | medium | 3 |
| 8 | **Random-event blips** (V) | Unusual moments get a short-lived blip on the minimap and a visit from the director camera: a command retried three times, a burst of helpers, a huge read. | small–medium | 4 |
| 9 | **Local weather that lingers** (VI) | Rain over the failing crew's corner rather than the whole town; puddles stay a few minutes; the rainbow stands over the building where the fix landed. | medium | 4 |
| 10 | **Photo mode** (VI "Photo Studio") | Freeze the town, orbit freely, tilt-shift blur (it suits a miniature town), hide HUD and labels, pick the time of day, save a PNG stamped with crew, duration and tool calls. | medium | sharing |
| 11 | **Cinema mode** (VI blends cutscenes and play) | Letterbox bars and no HUD while the director camera runs, for streaming the town on a second screen. | small | sharing |
| 12 | **Replay editor** (V's Rockstar Editor) | Replay a session from its events at 1–20× with a scrubber, and record it as a video. | large | debugging |
| 13 | **Crowds with routines** (VI) | Idle agents with habits (café, benches, chatting); a queue at the Permit Office when approvals pile up. Extras, if any, must look clearly unlike agents. | medium | life |
| 14 | **The in-game phone** (VI) | One overlay for messages (Post Office traffic as chats), approvals and jump-to-agent. Rejected for now: it would duplicate the panels Andary already has. | large | — |

## The order I would build them in

The owner's first complaint was not being able to see the town for the text, so the first steps
clear the screen and the next ones make the town tell you more without adding text.

1. **Clear the screen**: the bubble budget with the town feed (3), toasts moved to a corner and
   merged ("2 new crews"). *Small, and the biggest visible change after the labels.*
2. **"Needs you"**: crew stars and the tab-title count (2). *Small, and it is the one thing a busy
   person must never miss.*
3. **Minimap** (1), then **route line** (5) and **arrival caption** (4) on top of it.
4. **Task complete banner** (6) and **random-event blips** (8).
5. **Crew wheel** (7), **cinema mode** (11), **photo mode** (10).
6. Later, and only if wanted: local weather (9), routines (13), replay (12).

## Also worth doing (not from GTA)

- Make the Windows CI job required: it passes now, but is still allowed to fail.
- Let Dependabot rebase #31 (TypeScript 7, @types/node 26); the code already typechecks with them.
- On phones, frame the town a little closer by default, since the minimap will show the whole of it.

## Sources the research used

- Rockstar Games, Grand Theft Auto VI: https://www.rockstargames.com/VI
- Beebom, GTA 6 review roundup: https://beebom.com/gta-6-review-roundup/
- Game Informer review: https://gameinformer.com/review/grand-theft-auto-vi/outrageous-fortune
- Kotaku review: https://kotaku.com/grand-theft-auto-6-the-kotaku-review-2000757842
- Shacknews review: https://www.shacknews.com/article/151380/gta-6-review-score
- VGC, navigation options: https://www.videogameschronicle.com/guide/gta-6-navigation-experience-explained-which-navigation-experience-should-i-pick/
- VGC, changing characters: https://www.videogameschronicle.com/guide/how-to-change-characters-in-gta-6
- GamesRadar+, the wanted system: https://www.gamesradar.com/games/grand-theft-auto/gta-6-wanted-system-goes-up-to-6-stars-and-lets-police-track-your-face-your-clothes-and-your-car/
- TechRadar, details from the extended gameplay video: https://techradar.com/gaming/ps5/16-new-gta-6-details-we-learned-from-the-big-extended-look-gameplay-video-captured-in-game-on-a-ps5
- PC Gamer, character swapping: https://pcgamer.com/games/grand-theft-auto/big-new-gta-6-gameplay-details-revealed-including-specifics-about-jason-and-lucia-character-swapping-play-as-a-couple-or-go-off-and-cause-chaos-independently
- GTA BOOM, the minimap (pre-release footage): https://www.gtaboom.com/gta-6-minimap-c6d7
- GTA BOOM, the Game Informer cover story: https://www.gtaboom.com/everything-new-we-learned-about-gta-6-from-the-game-informer-cover-story-4d76
- IBTimes UK, social media in the game: https://www.ibtimes.co.uk/gta-6-social-media-features-explained-working-feeds-vice-city-vanity-viral-npcs-1822649
- Beebom, photo mode: https://beebom.com/gta-6-photo-mode/
- GTA Wiki, switch scenes in GTA V: https://gta.wiki/w/Switch_Scenes_in_GTA_V
- GTA Wiki (Fandom), the HUD: https://gta.fandom.com/wiki/Heads-Up_Display
- GTA Wiki, random events in GTA V: https://gta.wiki/w/Random_Events_in_Grand_Theft_Auto_V
- GamesRadar+, GTA V's video editor: https://gamesradar.com/take-look-gta-5-incredible-pc-exclusive-video-editor
