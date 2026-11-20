// Notifications on this computer, while the town is in a background tab: a crew needs your
// permission, a crew finished its turn, Claude Code stopped with an error. Off until the viewer
// turns them on (the browser then asks for permission); clicking one brings the town back.
// These stay on the computer, so they may name the crew. Phone notifications are the server's
// (server/notify.mjs).

/** @typedef {import('./types.js').HudContext} HudContext */

/** Older events are history (a reconnect replays them): never notify about those. */
const FRESH_MS = 15_000;

/**
 * What a store change deserves, or null.
 * @param {any} change
 * @param {import('./types.js').StoreState} state
 * @param {number} now
 * @returns {{ title: string, body: string, tag: string }|null}
 */
export function notificationFor(change, state, now) {
  const crew = (/** @type {string} */ id) => {
    const session = state.sessions.find((s) => s.id === id);
    return session ? session.title || session.project : 'A crew';
  };
  if (change.type === 'approval') {
    const a = change.approval;
    if (a?.status !== 'pending' || now - (Number(a.createdAt) || 0) > FRESH_MS) return null;
    return { title: 'Permission needed', body: `${crew(a.sessionId)} wants to use ${a.toolName ?? 'a tool'}.`, tag: `approval-${a.id}` };
  }
  if (change.type !== 'event') return null;
  const e = change.event;
  if (now - (Number(e.ts) || 0) > FRESH_MS) return null;
  // A teammate's crew (a team town) is theirs to watch, not yours.
  if (state.sessions.find((s) => s.id === e.sessionId)?.member) return null;
  if (e.kind === 'turn.stop' && e.agentKey?.endsWith(':main')) return { title: 'Turn finished', body: `${crew(e.sessionId)} is waiting for you.`, tag: `done-${e.sessionId}` };
  if (e.kind === 'turn.fail') return { title: 'Claude Code stopped', body: `${crew(e.sessionId)} stopped with an error.`, tag: `fail-${e.sessionId}` };
  return null;
}

/** @param {HudContext} ctx */
export function installNotifications(ctx) {
  return ctx.store.subscribe((change) => {
    if (!ctx.prefs.desktopNotify || !document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // Someone watching a team town with its view link: none of these crews are theirs.
    if (ctx.view.serverSettings.team?.role === 'viewer') return;
    const note = notificationFor(change, ctx.store.getState(), Date.now());
    if (!note) return;
    try {
      const n = new Notification(note.title, { body: note.body, tag: note.tag, icon: './favicon.svg' });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // some browsers only allow notifications from a service worker
    }
  });
}

/**
 * Turns notifications on (asking the browser first) or off. Returns what happened, in words.
 * @param {HudContext} ctx
 * @param {boolean} on
 * @returns {Promise<string>}
 */
export async function setDesktopNotify(ctx, on) {
  if (!on) {
    ctx.setPrefs({ desktopNotify: false });
    return 'Notifications are off.';
  }
  if (typeof Notification === 'undefined') return 'This browser cannot show notifications.';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') {
    ctx.setPrefs({ desktopNotify: false });
    return 'The browser blocked notifications for this page. Allow them in the site settings, then try again.';
  }
  ctx.setPrefs({ desktopNotify: true });
  return 'Notifications are on while the town is in the background.';
}
