// Modal dialogs: help (shortcuts and what each building means), settings, and "run it with your
// own Claude Code" (setup commands to copy). Native <dialog> + showModal() gives focus trapping,
// Escape to close and an inert background for free.
import { BUILDINGS, BUILDING_KEYS } from '../core/catalog.js';
import { h, setAttr, setHidden } from './dom.js';
import { BUILDING_ICONS, icon } from './icons.js';
import { kbd } from './parts.js';
import { SHORTCUT_HELP } from './shortcuts.js';
import { setDesktopNotify } from './notifications.js';
import { LOOKS } from '../core/looks.js';
import { LOOK } from '../page.js';

/** @typedef {import('./types.js').HudContext} HudContext */

/**
 * A dialog shell with a title, a close button and a body. `scrollable` makes the body itself a
 * tab stop, for text-only dialogs that may need scrolling from the keyboard.
 * @param {{ id: string, title: string, body: HTMLElement[], wide?: boolean, scrollable?: boolean }} options
 */
export function createDialog({ id, title, body, wide = false, scrollable = false }) {
  const close = h('button', { type: 'button', class: 'hud-iconbtn', 'aria-label': 'Close' }, icon('close'));
  const content = h('div', { class: 'hud-dialog__body', tabindex: scrollable ? '0' : null, role: scrollable ? 'region' : null, 'aria-labelledby': scrollable ? `${id}-title` : null }, ...body);
  const dialog = /** @type {HTMLDialogElement} */ (h('dialog', { class: `hud hud-dialog${wide ? ' hud-dialog--wide' : ''}`, id, 'aria-labelledby': `${id}-title` },
    h('div', { class: 'hud-dialog__head' }, h('h2', { class: 'hud-dialog__title', id: `${id}-title`, text: title }), close),
    content));
  close.addEventListener('click', () => dialog.close());
  // A click on the backdrop lands on the dialog element itself, outside its content box.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) dialog.close();
  });
  /** @type {HTMLElement|null} */
  let opener = null;
  dialog.addEventListener('close', () => {
    if (opener?.isConnected) opener.focus();
    opener = null;
  });
  return {
    el: dialog,
    open() {
      if (dialog.open) return;
      const active = document.activeElement;
      opener = active instanceof HTMLElement && active !== document.body ? active : null;
      dialog.showModal();
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.open;
    },
  };
}

/** @param {HudContext} ctx */
export function createHelpDialog(ctx) {
  const rows = SHORTCUT_HELP.map((item) => {
    const keys = item.keys.length === 2 && item.keys[0] === '1' ? [kbd('1'), ' to ', kbd('9')] : item.keys.flatMap((key, i) => (i ? [' ', kbd(key)] : [kbd(key)]));
    return h('tr', { class: item.demoOnly ? 'hud-help__demo' : null }, h('th', { scope: 'row' }, ...keys), h('td', { text: item.label }));
  });
  const shortcuts = h('table', { class: 'hud-help__keys' }, h('caption', { class: 'hud-sr', text: 'Keyboard shortcuts' }), h('tbody', {}, ...rows));
  const places = h('ul', { class: 'hud-help__places' }, ...BUILDING_KEYS.map((key) => h('li', {},
    h('span', { class: 'hud-help__place-icon', 'aria-hidden': 'true' }, icon(BUILDING_ICONS[key], { size: 18 })),
    h('span', {}, h('strong', { text: BUILDINGS[key].name }), ' ', BUILDINGS[key].blurb))));
  const dialog = createDialog({
    id: 'hud-help',
    title: 'How Andary works',
    wide: true,
    scrollable: true,
    body: [
      h('p', { class: 'hud-dialog__lead' }, 'Every Claude Code session is a crew. Its agents walk to the building that matches the tool they are using, so you can see at a glance who is reading, editing, running commands or waiting for you.'),
      h('div', { class: 'hud-help__cols' },
        h('section', {}, h('h3', { class: 'hud-dialog__sub', text: 'Keyboard shortcuts' }), shortcuts,
          h('p', { class: 'hud-dialog__note' }, 'In the 3D view: arrow keys pan, ', kbd('Q'), ' and ', kbd('E'), ' rotate. Shortcuts pause while you type.')),
        h('section', {}, h('h3', { class: 'hud-dialog__sub', text: 'Around town' }), places)),
    ],
  });
  return {
    el: dialog.el,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
    open() {
      for (const row of dialog.el.querySelectorAll('.hud-help__demo')) setHidden(/** @type {HTMLElement} */ (row), ctx.view.mode !== 'demo');
      dialog.open();
    },
  };
}

/** @param {HudContext} ctx */
export function createSettingsDialog(ctx) {
  const remote = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', class: 'hud-switch', id: 'hud-set-remote', 'data-testid': 'remote-approvals-toggle', role: 'switch' }));
  const remoteBlock = h('div', { class: 'hud-setting' },
    settingRow('hud-set-remote', 'Remote approvals', remote),
    h('p', { class: 'hud-setting__help', id: 'hud-set-remote-help', text: 'Claude Code waits up to two minutes for your answer here before asking in the terminal. Off: requests still show up here, but you answer them in the terminal.' }));
  setAttr(remote, 'aria-describedby', 'hud-set-remote-help');
  remote.addEventListener('change', () => ctx.controls.setRemoteApprovals(remote.checked));

  const theme = choice('hud-set-theme', 'Theme', [['auto', 'Match the town and system'], ['light', 'Light'], ['dark', 'Dark']], ctx.prefs.theme, (value) => ctx.setPrefs({ theme: /** @type {any} */ (value) }));
  const motion = choice('hud-set-motion', 'Motion', [['system', 'Match system setting'], ['reduce', 'Reduce motion'], ['full', 'Full motion']], ctx.prefs.motion, (value) => ctx.setPrefs({ motion: /** @type {any} */ (value) }));
  // Choosing only selects: browsing the list with the arrow keys must not reload the page
  // (WCAG 3.2.2). The button applies it.
  const look = choice('hud-set-look', 'Town look', LOOKS.map((l) => [l.id, l.name]), LOOK, (value) => {
    applyLook.disabled = value === LOOK;
  });
  const applyLook = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'apply-look', disabled: true }, 'Rebuild the town'));
  applyLook.addEventListener('click', () => {
    const value = look.value();
    ctx.setPrefs({ townLook: /** @type {any} */ (value) });
    lookHelp.textContent = 'Rebuilding the town with its new look…';
    applyLook.disabled = true;
    // The town's colours are part of its geometry, so a new look means building it again.
    const url = new URL(location.href);
    url.searchParams.delete('look');
    setTimeout(() => location.replace(url.href), 250);
  });
  const lookHelp = h('p', { class: 'hud-setting__help', role: 'status', text: 'The whole town, its sky and its sea. Rebuilding reloads the page.' });
  look.el.append(applyLook, lookHelp);
  const quality = choice('hud-set-quality', 'Graphics', [['auto', 'Automatic'], ['high', 'High quality'], ['low', 'Low power']], ctx.prefs.quality, (value) => ctx.setPrefs({ quality: /** @type {any} */ (value) }));

  const volume = /** @type {HTMLInputElement} */ (h('input', { type: 'range', class: 'hud-range', id: 'hud-set-volume', min: '0', max: '100', step: '5', value: String(Math.round(ctx.prefs.volume * 100)) }));
  volume.addEventListener('input', () => {
    ctx.setPrefs({ volume: Number(volume.value) / 100 });
    ctx.sound.setVolume(Number(volume.value) / 100);
  });
  const volumeBlock = h('div', { class: 'hud-setting' },
    settingRow('hud-set-volume', 'Sound volume', volume),
    h('p', { class: 'hud-setting__help', text: 'Sound is off until you turn it on with the speaker button or M.' }));
  const ambient = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', class: 'hud-switch', id: 'hud-set-ambient', role: 'switch', checked: ctx.prefs.ambient, 'data-testid': 'ambient-toggle' }));
  ambient.addEventListener('change', () => {
    ctx.setPrefs({ ambient: ambient.checked });
    ctx.sound.setAmbient({ wanted: ambient.checked });
  });
  const ambientBlock = h('div', { class: 'hud-setting' },
    settingRow('hud-set-ambient', 'Ambient sound', ambient),
    h('p', { class: 'hud-setting__help', text: 'While sound is on: waves, gulls by day and crickets by night, a city hum and soft chords that grow busier with the crews, and rain with the town\'s weather.' }));

  const announce = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', class: 'hud-switch', id: 'hud-set-announce', role: 'switch', checked: ctx.prefs.announce }));
  announce.addEventListener('change', () => {
    ctx.setPrefs({ announce: announce.checked });
    ctx.announcer.setActivityEnabled(announce.checked);
  });
  const announceBlock = h('div', { class: 'hud-setting' },
    settingRow('hud-set-announce', 'Read out activity', announce),
    h('p', { class: 'hud-setting__help', text: 'Screen readers hear a short summary of new activity at most every five seconds.' }));

  const weather = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', class: 'hud-switch', id: 'hud-set-weather', role: 'switch', checked: ctx.prefs.weather, 'data-testid': 'weather-toggle' }));
  weather.addEventListener('change', () => ctx.setPrefs({ weather: weather.checked }));
  const weatherBlock = h('div', { class: 'hud-setting' },
    settingRow('hud-set-weather', 'Town weather', weather),
    h('p', { class: 'hud-setting__help', text: 'Rain when commands fail, a storm when they keep failing, a rainbow when tests pass again, fog while a crew thinks for a long time.' }));

  const notify = notifyBlocks(ctx);
  const teamText = h('p', { class: 'hud-setting__help', 'data-testid': 'team-text' });
  const teamBlock = h('div', { class: 'hud-setting' }, h('p', { class: 'hud-setting__name', text: 'Team town' }), teamText);

  const helpButton = h('button', { type: 'button', class: 'hud-btn' }, icon('help', { size: 18 }), 'Shortcuts and help');
  const setupButton = h('button', { type: 'button', class: 'hud-btn' }, icon('terminal', { size: 18 }), 'Use your own Claude Code');
  const leaveButton = h('button', { type: 'button', class: 'hud-btn' }, icon('external', { size: 18 }), 'Leave the demo');

  const dialog = createDialog({
    id: 'hud-settings',
    title: 'Settings',
    body: [teamBlock, remoteBlock, look.el, theme.el, motion.el, quality.el, weatherBlock, notify.desktop, notify.phone, volumeBlock, ambientBlock, announceBlock, h('div', { class: 'hud-dialog__actions' }, helpButton, setupButton, leaveButton)],
  });
  helpButton.addEventListener('click', () => {
    dialog.close();
    ctx.openDialog('help');
  });
  setupButton.addEventListener('click', () => {
    dialog.close();
    ctx.openDialog('setup');
  });
  leaveButton.addEventListener('click', () => ctx.controls.leaveDemo());

  // Delegate rather than spread: a spread would copy isOpen's value once instead of the getter.
  return {
    el: dialog.el,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
    open() {
      const live = ctx.view.mode === 'live';
      const team = live ? ctx.view.serverSettings.team : null;
      const viewer = team?.role === 'viewer';
      setHidden(teamBlock, !team);
      teamText.textContent = team ? teamSentence(team) : '';
      setHidden(remoteBlock, !live || viewer);
      remote.checked = Boolean(ctx.view.serverSettings.remoteApprovals);
      remote.disabled = ctx.view.connection !== 'live';
      setHidden(setupButton, live || ctx.view.serverAvailable);
      setHidden(leaveButton, live || !(ctx.view.serverAvailable || ctx.view.demoForced));
      theme.set(ctx.prefs.theme);
      motion.set(ctx.prefs.motion);
      quality.set(ctx.prefs.quality);
      look.set(LOOK);
      applyLook.disabled = true;
      weather.checked = ctx.prefs.weather;
      ambient.checked = ctx.prefs.ambient;
      notify.sync();
      setHidden(notify.phone, !live || viewer);
      dialog.open();
    },
    /** Keeps the switch in step when the server reports a settings change. */
    sync() {
      remote.checked = Boolean(ctx.view.serverSettings.remoteApprovals);
      remote.disabled = ctx.view.connection !== 'live';
    },
  };
}

/**
 * @param {{ role: 'owner'|'viewer', members: string[] }} team
 * @returns {string}
 */
export function teamSentence({ role, members }) {
  const who = members.length ? `Sharing so far: ${members.join(', ')}.` : 'No teammate has shared a session yet.';
  if (role === 'viewer') return `You are watching a team town. Only the person who hosts it can answer permission prompts or change its settings. ${who}`;
  return `This town hosts your team. ${who} Invite someone with: andary team invite <name>`;
}

/**
 * The two notification settings: on this computer (a browser permission) and on a phone (the
 * server's ntfy topic, shown with a test button when it is on).
 * @param {HudContext} ctx
 */
function notifyBlocks(ctx) {
  const desktopSwitch = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', class: 'hud-switch', id: 'hud-set-notify', role: 'switch', 'data-testid': 'desktop-notify-toggle' }));
  const desktopHelp = h('p', { class: 'hud-setting__help', id: 'hud-set-notify-help', role: 'status', text: 'When the town is in a background tab: a crew needs your permission, finished its turn or stopped with an error.' });
  setAttr(desktopSwitch, 'aria-describedby', 'hud-set-notify-help');
  desktopSwitch.addEventListener('change', async () => {
    desktopHelp.textContent = await setDesktopNotify(ctx, desktopSwitch.checked);
    desktopSwitch.checked = ctx.prefs.desktopNotify;
  });
  const desktop = h('div', { class: 'hud-setting' }, settingRow('hud-set-notify', 'Notifications on this computer', desktopSwitch), desktopHelp);

  const phoneText = h('p', { class: 'hud-setting__help', 'data-testid': 'phone-notify-text' });
  const topic = h('code', { class: 'hud-mono hud-steps__code' });
  const copy = h('button', { type: 'button', class: 'hud-btn hud-btn--small' }, icon('copy', { size: 16 }), h('span', { text: 'Copy' }));
  copy.addEventListener('click', () => copyCommand(topic.textContent ?? '', topic, copy, ctx));
  const test = h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'phone-notify-test' }, icon('bell', { size: 16 }), h('span', { text: 'Send a test' }));
  test.addEventListener('click', () => ctx.controls.notifyTest());
  const topicRow = h('div', { class: 'hud-steps__command' }, topic, copy, test);
  const phone = h('div', { class: 'hud-setting' }, h('p', { class: 'hud-setting__name', text: 'Notifications on your phone' }), phoneText, topicRow);

  return {
    desktop,
    phone,
    sync() {
      desktopSwitch.checked = ctx.prefs.desktopNotify;
      const live = ctx.view.mode === 'live';
      setHidden(phone, !live);
      const url = ctx.view.serverSettings.notifyUrl;
      setHidden(topicRow, !url);
      topic.textContent = url ?? '';
      phoneText.textContent = url
        ? 'On. Install the free ntfy app and subscribe to this address. Messages only say what happened, never your project or commands.'
        : 'Off. Start Andary with --notify to get them on your phone through the free ntfy app (no account).';
    },
  };
}

/**
 * A labelled <select>.
 * @param {string} id
 * @param {string} label
 * @param {[string, string][]} options
 * @param {string} value
 * @param {(value: string) => void} onChange
 */
function choice(id, label, options, value, onChange) {
  const select = /** @type {HTMLSelectElement} */ (h('select', { class: 'hud-select', id }, ...options.map(([v, text]) => h('option', { value: v, text }))));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  const el = h('div', { class: 'hud-setting' }, settingRow(id, label, select));
  return { el, set: (/** @type {string} */ v) => { select.value = v; }, value: () => select.value };
}

/**
 * A setting's name and control side by side. The label holds only text: a control inside a
 * label would add its own value to the accessible name ("Sound volume 60").
 * @param {string} id
 * @param {string} name
 * @param {HTMLElement} control
 */
function settingRow(id, name, control) {
  return h('div', { class: 'hud-setting__row' }, h('label', { class: 'hud-setting__name', for: id, text: name }), control);
}

const SETUP_STEPS = [
  { title: 'Install the andary command', command: 'npm install -g github:eylem2002/andary', note: 'Installs straight from GitHub. Andary has no runtime dependencies.' },
  { title: 'Add the Andary hooks to Claude Code', command: 'andary install', note: 'Registers the hooks in ~/.claude/settings.json, for every project. Using Codex? Run andary install codex too, and trust the hooks when Codex asks. Undo any time with andary uninstall.' },
  { title: 'Start the town', command: 'andary start', note: 'Runs a small server on 127.0.0.1 only, and prints a link that signs your browser in.' },
  { title: 'Open the link, then use Claude Code as usual', command: 'claude', note: 'Every session, subagent and teammate shows up as a crew in the town (Codex sessions too, with codex).' },
];

/** @param {HudContext} ctx */
export function createSetupDialog(ctx) {
  const steps = h('ol', { class: 'hud-steps' }, ...SETUP_STEPS.map((step) => {
    const code = h('code', { class: 'hud-mono hud-steps__code', text: step.command });
    const copy = h('button', { type: 'button', class: 'hud-btn hud-btn--small' }, icon('copy', { size: 16 }), h('span', { text: 'Copy' }));
    copy.addEventListener('click', () => copyCommand(step.command, code, copy, ctx));
    return h('li', { class: 'hud-steps__step' },
      h('h3', { class: 'hud-steps__title', text: step.title }),
      h('div', { class: 'hud-steps__command' }, code, copy),
      h('p', { class: 'hud-steps__note', text: step.note }));
  }));
  const dialog = createDialog({
    id: 'hud-setup',
    title: 'Run it with your own Claude Code',
    body: [
      h('p', { class: 'hud-dialog__lead', text: 'This is a demo town with simulated crews. On your own machine, Andary shows your real Claude Code (or Codex) sessions as they work. You need Node.js 20 or newer.' }),
      steps,
      h('p', { class: 'hud-dialog__note', text: 'Everything stays on your computer: the server only listens on 127.0.0.1, and your prompts and commands are never written to disk unless you ask it to record.' }),
    ],
  });
  const keepWatching = h('button', { type: 'button', class: 'hud-btn hud-btn--primary', autofocus: true }, 'Keep watching the demo');
  keepWatching.addEventListener('click', () => dialog.close());
  dialog.el.querySelector('.hud-dialog__body')?.append(h('div', { class: 'hud-dialog__actions' }, keepWatching));
  // Seen once, it is not offered again: kept as soon as it opens, not only when it closes (a
  // dialog's close event comes a moment after it disappears, and the page may be gone by then).
  return {
    ...dialog,
    open() {
      dialog.open();
      ctx.setPrefs({ setupSeen: true });
    },
    get isOpen() {
      return dialog.isOpen;
    },
  };
}

/**
 * Copies a command; inside the click handler so the clipboard API is allowed. When it is not
 * (insecure origin, permissions), the command is selected so the viewer can copy it by hand.
 * @param {string} command
 * @param {HTMLElement} code
 * @param {HTMLElement} button
 * @param {HudContext} ctx
 */
async function copyCommand(command, code, button, ctx) {
  const label = /** @type {HTMLElement} */ (button.lastElementChild);
  try {
    await navigator.clipboard.writeText(command);
    label.textContent = 'Copied';
    ctx.announcer.polite(`Copied ${command}`);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    label.textContent = 'Press Ctrl+C';
    ctx.announcer.polite('Selected the command. Press Control C or Command C to copy it.');
  }
  setTimeout(() => {
    label.textContent = 'Copy';
  }, 2500);
}
