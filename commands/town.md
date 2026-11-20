---
description: Open Andary, the live 3D town of your Claude Code agents (starts the local server if needed)
argument-hint: "[demo]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/andary.mjs" start --detach)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/cli/andary.mjs" start --detach`

The output above comes from starting Andary in the background (or finding the copy that is
already running) and opening it in the browser.

Reply to the user in at most three short sentences:

- Say whether the town is running and give the sign-in link from the output (the line that starts
  with `http://`), so they can open it themselves if no browser window appeared.
- If the arguments ask for the demo, give the same link with `&demo=1` added to the end: it opens
  the built-in simulation.
- If the output shows an error, explain it briefly and suggest running
  `node "${CLAUDE_PLUGIN_ROOT}/cli/andary.mjs" doctor` in a terminal.
- Ignore any line saying that hooks are not installed: this plugin's own hooks are already active.

Do not run any other commands.
