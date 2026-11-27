// Where the town's events come from (JSDoc only, no runtime code). The browser has two sources
// behind one shape: live (sources/live.js, the WebSocket link to the local server) and demo
// (sources/demo.js, the built-in simulation, which plays the server's part: approvals, usage and
// the town's growth). Both feed the same store with the same envelopes; main.js holds exactly one.

/**
 * @typedef {object} TownSource
 * @property {'live'|'demo'} mode
 * @property {(id: string, decision: 'allow'|'deny', message?: string, always?: number, stop?: boolean) => boolean} decide  answer a held
 *   permission request: a denial may say why, and stop the agent too (`stop`, "Deny and stop"); an allow may save one
 *   of its suggestions (`always`, its index, CONTRACTS §4.5)
 * @property {(sessionId: string, agentId: string|null, text: string, ref: string) => boolean} [sendNote]  live: a note for
 *   one agent's next step (§4.15), answered with its `ref`; the demo has none
 * @property {(since: number) => boolean} requestDigest  ask what each crew did since a time; the answer comes as the source's onDigest
 * @property {(on: boolean) => unknown} [setRemoteApprovals]  live: the server's switch
 * @property {(on: boolean) => unknown} [setHoldRisky]  live: the server's "Always hold risky commands for me" switch
 * @property {(on: boolean) => void} [holdApprovals]     demo: a card waiting for an answer shows in the Approvals panel, so countdowns hold
 * @property {(profile: import('../core/profile.js').Profile) => boolean} [saveProfile]  this person's profile: live, on the team host (§4.11); demo, in the demo's people
 * @property {(to: [number, number]) => boolean} [walk]      this person's character walks to a tile (§4.11)
 * @property {(kind: 'emote'|'phrase', id: number) => boolean} [say]  one of the set emotes or phrases over their character
 * @property {(to: string, at: { agent: string }|{ building: string }) => boolean} [lookAsk]  asks a teammate to come look
 * @property {() => boolean} [notifyTest]                    live: a test phone notification
 * @property {(paused: boolean) => void} [setPaused]         demo: pause the story
 * @property {(speed: number) => void} [setSpeed]            demo: 1×, 2×, 4×
 * @property {() => void} close                              stop, and let anything waiting carry on
 */

export {};
