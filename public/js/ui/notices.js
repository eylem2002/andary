// Notices over the town for moments with nothing to watch: a live server with no sessions yet, a
// browser that is not signed in, and a browser that cannot draw the 3D town. Each says what is
// going on and what to do next.
import { h, setAttr, setHidden } from './dom.js';
import { icon } from './icons.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {'waiting'|'signin'|null} NoticeKind */

/** @param {HudContext} ctx */
export function createNotices(ctx) {
  const demoButton = h('button', { type: 'button', class: 'hud-btn hud-btn--primary', 'data-testid': 'demo-button' }, icon('play', { size: 18 }), 'Watch the demo');
  demoButton.addEventListener('click', () => ctx.controls.startDemo());

  const waiting = h('div', { class: 'hud-notice__body', hidden: true },
    h('h2', { class: 'hud-notice__title', id: 'hud-notice-waiting', text: 'Waiting for Claude Code' }),
    h('p', {}, 'Start ', h('code', { class: 'hud-mono', text: 'claude' }), ' in any project and this town fills up.'));
  const signin = h('div', { class: 'hud-notice__body', 'data-testid': 'login-hint', hidden: true },
    h('h2', { class: 'hud-notice__title', id: 'hud-notice-signin', text: 'Sign in to see your town' }),
    h('p', {}, 'Open the link printed in your terminal. It starts with ', h('code', { class: 'hud-mono', text: 'http://127.0.0.1:' }), ' and ends with a ', h('code', { class: 'hud-mono', text: '?token=' }), ' that signs this browser in.'),
    h('p', { class: 'hud-notice__aside' }, 'Lost it? Run ', h('code', { class: 'hud-mono', text: 'andary status' }), ' to print it again.'));
  const notice = h('section', { class: 'hud hud-notice', hidden: true }, waiting, signin, h('div', { class: 'hud-notice__actions' }, demoButton));

  const fallback = h('section', { class: 'hud hud-notice hud-notice--quiet', 'aria-labelledby': 'hud-fallback-title', hidden: true },
    h('div', { class: 'hud-notice__body' },
      h('h2', { class: 'hud-notice__title', id: 'hud-fallback-title', text: 'The 3D town could not start' }),
      h('p', {}, 'This browser has WebGL turned off or unavailable, so the town cannot be drawn. The crews, tasks, activity and approvals panels still follow every agent.')));

  const el = h('div', { class: 'hud-center' }, fallback, notice);

  /** @param {NoticeKind} kind */
  function show(kind) {
    setHidden(notice, !kind);
    setHidden(waiting, kind !== 'waiting');
    setHidden(signin, kind !== 'signin');
    setAttr(notice, 'aria-labelledby', kind ? `hud-notice-${kind}` : null);
  }

  function showWorldFallback() {
    setHidden(fallback, false);
  }

  return { el, show, showWorldFallback };
}
