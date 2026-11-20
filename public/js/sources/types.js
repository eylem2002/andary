// Where the town's events come from (JSDoc only, no runtime code). The browser has two sources
// behind one shape: live (sources/live.js, the WebSocket link to the local server) and demo
// (sources/demo.js, the built-in simulation, which plays the server's part: approvals, usage and
// the town's growth). Both feed the same store with the same envelopes; main.js holds exactly one.

/**
 * @typedef {object} TownSource
 * @property {'live'|'demo'} mode
 * @property {(id: string, decision: 'allow'|'deny') => boolean} decide  answer a held permission request
 * @property {(on: boolean) => unknown} [setRemoteApprovals]  live: the server's switch
 * @property {() => boolean} [notifyTest]                    live: a test phone notification
 * @property {(paused: boolean) => void} [setPaused]         demo: pause the story
 * @property {(speed: number) => void} [setSpeed]            demo: 1×, 2×, 4×
 * @property {() => void} close                              stop, and let anything waiting carry on
 */

export {};
