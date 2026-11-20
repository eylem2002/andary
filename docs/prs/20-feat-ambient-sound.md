# Ambient sound

Part 20 of 30 · base: `feat/notifications`

## What changed

With sound on, the town has a soundscape, synthesised with WebAudio (`public/js/ui/ambient.js`,
no audio files):

- waves on the shore (brown noise that swells), a city hum that grows with the number of
  working agents, gulls by day and crickets by night, rain when the town's weather rains;
- a soft pad of four slow chords (Cmaj7, Am7, Fmaj7, G6) that gets fuller when the crews are
  busy.

The mix (`ambientMix`) is updated every two seconds from the agents, the town's clock and the
weather. It shares the sound effects' context and volume, plays only while sound is on and
Settings → Ambient sound is on (saved, on by default), and fades out when the tab is hidden.

## Tests

- `test/unit/ui/ambient.test.mjs`: the mix (work, night, rain), and the bed with a stand-in
  AudioContext: three loops, chords while playing, nothing new once stopped.
- `e2e/features.spec.mjs`: the Settings switch is saved; turning sound on with it raises no
  error.
