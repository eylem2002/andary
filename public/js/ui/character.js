// The "You" dialog (CONTRACTS §4.11): a person of a team town chooses their character's whole
// look (hair, face, clothes, shoes, hat, an extra), their colour and their home's style, with a
// live preview and a Random button. Opened from Settings. Every choice is a native control (a
// select, or a radio group of colour swatches), so the keyboard, screen readers and phones get
// them for free. Saving sends the profile (live: to the team host; demo: to the demo's people)
// and keeps a copy in this browser, sent again after a `team reset` forgets it.
import { CREW_COLORS } from '../core/catalog.js';
import { LOOKS } from '../core/looks.js';
import { CLOTH_COLORS, HAIR_COLORS, LOOK_CHOICES, PERSON_COLOR_NAMES, SKIN_TONES, defaultProfile, randomProfile, validateProfile } from '../core/profile.js';
import { createDialog } from './dialogs.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { drawPreview } from './character-preview.js';

/** @typedef {import('../core/profile.js').Profile} Profile */
/** @typedef {import('./town-people.js').PersonView} PersonView */

/** Where this browser keeps its own profile, to send again after a `team reset`. */
const STORAGE_KEY = 'andary:profile';

/** Words for the enumerated choices. */
const WORDS = Object.freeze({
  short: 'Short', long: 'Long', bun: 'Bun', curly: 'Curly', buzz: 'Buzz cut', bald: 'Bald',
  dot: 'Dots', round: 'Round', happy: 'Happy',
  none: 'None', freckles: 'Freckles', beard: 'Beard', moustache: 'Moustache', glasses: 'Glasses',
  tee: 'T-shirt', hoodie: 'Hoodie', jacket: 'Jacket', sweater: 'Sweater',
  trousers: 'Trousers', shorts: 'Shorts', skirt: 'Skirt',
  boots: 'Boots', sneakers: 'Sneakers', sandals: 'Sandals',
  cap: 'Cap', beanie: 'Beanie', beret: 'Beret', sunhat: 'Sun hat', wizard: 'Wizard hat', crown: 'Crown', hardhat: 'Hard hat',
  cape: 'Cape', scarf: 'Scarf', backpack: 'Backpack', headphones: 'Headphones',
});

/** @param {string} value */
const word = (value) => /** @type {Record<string, string>} */ (WORDS)[value] ?? value;

/**
 * One sentence for screen readers (the preview's label) and the dialog's status.
 * @param {Profile} profile
 * @returns {string}
 */
export function describeLook(profile) {
  const l = profile.look;
  const top = l.topColor === 'theme' ? PERSON_COLOR_NAMES[profile.color].toLowerCase() : CLOTH_COLORS[l.topColor].name.toLowerCase();
  const hair = l.hair === 'bald' ? 'bald' : `${HAIR_COLORS[l.hairColor].name.toLowerCase()} ${word(l.hair).toLowerCase()} hair`;
  const face = l.face === 'none' ? '' : `, ${word(l.face).toLowerCase()}`;
  const hat = l.hat === 'none' ? '' : `, a ${word(l.hat).toLowerCase()}`;
  const extra = l.extra === 'none' ? '' : ` and a ${word(l.extra).toLowerCase()}`;
  return `${SKIN_TONES[l.skin].name} skin, ${hair}${face}${hat}, a ${top} ${word(l.top).toLowerCase()}, ${CLOTH_COLORS[l.bottomColor].name.toLowerCase()} ${word(l.bottom).toLowerCase()}, ${CLOTH_COLORS[l.shoesColor].name.toLowerCase()} ${word(l.shoes).toLowerCase()}${extra}.`;
}

/** @returns {Profile|null} this browser's saved profile, if it is still valid */
export function loadSavedProfile() {
  try {
    const check = validateProfile(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null'));
    return check.ok ? check.profile : null;
  } catch {
    return null;
  }
}

/** @param {Profile} profile */
function saveLocally(profile) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage blocked: the host still keeps it.
  }
}

/** @typedef {{ name: string, hex: string }} Swatch */

/**
 * @param {import('./types.js').HudContext} ctx
 */
export function createCharacterDialog(ctx) {
  /** @type {Profile} */
  let draft = defaultProfile(0);
  const preview = h('div', { class: 'hud-character__preview', role: 'img' });
  const caption = h('p', { class: 'hud-character__caption', 'aria-hidden': 'true' });
  const status = h('p', { class: 'hud-setting__help', role: 'status', 'data-testid': 'character-status' });

  const color = swatches('hud-char-color', 'Your colour', CREW_COLORS.map((hex, i) => ({ name: PERSON_COLOR_NAMES[i], hex })), (i) => update({ color: i }));
  const house = select('hud-char-house', 'Your home', LOOKS.map((look) => [look.id, `${look.name} house`]), (value) => update({ house: /** @type {any} */ (value) }));
  // The first top colour is the person's own, so its swatch follows the colour they choose.
  const topSwatches = swatches('hud-char-top-color', 'Top colour', [{ name: 'Your colour', hex: '' }, ...CLOTH_COLORS], (i) => look({ topColor: i === 0 ? 'theme' : i - 1 }));
  /** @type {Record<string, { el: HTMLElement, set: (value: any) => void }>} */
  const fields = {
    hair: select('hud-char-hair', 'Hair', enumOptions('hair'), (v) => look({ hair: v })),
    hairColor: swatches('hud-char-hair-color', 'Hair colour', HAIR_COLORS, (i) => look({ hairColor: i })),
    skin: swatches('hud-char-skin', 'Skin', SKIN_TONES, (i) => look({ skin: i })),
    eyes: select('hud-char-eyes', 'Eyes', enumOptions('eyes'), (v) => look({ eyes: v })),
    face: select('hud-char-face', 'Face', enumOptions('face'), (v) => look({ face: v })),
    top: select('hud-char-top', 'Top', enumOptions('top'), (v) => look({ top: v })),
    topColor: topSwatches,
    bottom: select('hud-char-bottom', 'Bottoms', enumOptions('bottom'), (v) => look({ bottom: v })),
    bottomColor: swatches('hud-char-bottom-color', 'Bottoms colour', CLOTH_COLORS, (i) => look({ bottomColor: i })),
    shoes: select('hud-char-shoes', 'Shoes', enumOptions('shoes'), (v) => look({ shoes: v })),
    shoesColor: swatches('hud-char-shoes-color', 'Shoes colour', CLOTH_COLORS, (i) => look({ shoesColor: i })),
    hat: select('hud-char-hat', 'Hat', enumOptions('hat'), (v) => look({ hat: v })),
    extra: select('hud-char-extra', 'Extra', enumOptions('extra'), (v) => look({ extra: v })),
  };

  const random = h('button', { type: 'button', class: 'hud-btn', 'data-testid': 'character-random' }, icon('repeat', { size: 18 }), 'Random');
  const save = h('button', { type: 'button', class: 'hud-btn hud-btn--primary', 'data-testid': 'character-save' }, icon('check', { size: 18 }), 'Save');
  const cancel = h('button', { type: 'button', class: 'hud-btn' }, 'Cancel');
  random.addEventListener('click', () => {
    draft = randomProfile(Math.random, { color: draft.color, house: draft.house });
    show();
    status.textContent = `New look: ${describeLook(draft)}`;
  });
  save.addEventListener('click', () => {
    if (!ctx.controls.saveProfile?.(draft)) {
      status.textContent = 'Not saved: the town is not connected right now. Try again in a moment.';
      return;
    }
    saveLocally(draft);
    dialog.close();
  });
  cancel.addEventListener('click', () => dialog.close());

  const dialog = createDialog({
    id: 'hud-character',
    title: 'You',
    wide: true,
    body: [
      h('div', { class: 'hud-character' },
        h('div', { class: 'hud-character__stage' }, preview, caption),
        h('div', { class: 'hud-character__form' },
          h('p', { class: 'hud-dialog__lead', text: 'Choose how your character looks in the team town, its colour and your home. Everyone sees the same.' }),
          color.el, house.el, ...Object.values(fields).map((field) => field.el))),
      status,
      h('div', { class: 'hud-dialog__actions' }, random, cancel, save),
    ],
  });
  dialog.el.dataset.testid = 'character-dialog';

  /** @param {Partial<Profile>} patch */
  function update(patch) {
    draft = { ...draft, ...patch };
    show();
  }

  /** @param {Record<string, unknown>} patch  checked again when it is saved */
  function look(patch) {
    draft = { ...draft, look: /** @type {import('../core/profile.js').PersonLook} */ ({ ...draft.look, ...patch }) };
    show();
  }

  /** Draws the preview and sets every control from the draft. */
  function show() {
    const people = /** @type {PersonView[]} */ (ctx.view.people ?? []);
    const others = people.filter((p) => p.name !== ctx.view.me);
    color.set(draft.color);
    color.disable(new Map(others.map((p) => [p.color, p.name])));
    house.set(draft.house);
    for (const [field, control] of Object.entries(fields)) {
      const value = /** @type {any} */ (draft.look)[field];
      control.set(field === 'topColor' ? (value === 'theme' ? 0 : value + 1) : value);
    }
    topSwatches.recolor(0, CREW_COLORS[draft.color]);
    drawPreview(preview, draft, CREW_COLORS[draft.color]);
    preview.setAttribute('aria-label', `Preview of your character: ${describeLook(draft)}`);
    caption.textContent = `${ctx.view.me ?? 'You'}, home: ${LOOKS.find((l) => l.id === draft.house)?.name ?? ''}`;
  }

  return {
    el: dialog.el,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
    open() {
      const people = /** @type {PersonView[]} */ (ctx.view.people ?? []);
      const mine = people.find((p) => p.name === ctx.view.me);
      draft = mine?.profile ? { ...mine.profile, color: mine.color } : (loadSavedProfile() ?? defaultProfile(mine?.color ?? 0));
      status.textContent = '';
      show();
      dialog.open();
    },
  };
}

/** @param {keyof typeof LOOK_CHOICES} field @returns {[string, string][]} */
function enumOptions(field) {
  return /** @type {readonly string[]} */ (LOOK_CHOICES[field]).map((value) => [value, word(value)]);
}

/**
 * A labelled <select>.
 * @param {string} id @param {string} label @param {[string, string][]} options @param {(value: string) => void} onChange
 */
function select(id, label, options, onChange) {
  const control = /** @type {HTMLSelectElement} */ (h('select', { class: 'hud-select', id }, ...options.map(([value, text]) => h('option', { value, text }))));
  control.addEventListener('change', () => onChange(control.value));
  const el = h('div', { class: 'hud-setting hud-character__field' }, h('div', { class: 'hud-setting__row' }, h('label', { class: 'hud-setting__name', for: id, text: label }), control));
  return { el, set: (/** @type {string} */ value) => { control.value = value; } };
}

/**
 * A radio group of colour swatches: arrow keys move through it, and each swatch is named.
 * @param {string} id @param {string} label @param {ReadonlyArray<Swatch>} colors @param {(index: number) => void} onChange
 */
function swatches(id, label, colors, onChange) {
  const inputs = colors.map((_color, i) => {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: id, id: `${id}-${i}`, value: String(i), class: 'hud-swatch__input' }));
    input.addEventListener('change', () => {
      if (input.checked) onChange(i);
    });
    return input;
  });
  const chips = colors.map((color) => {
    const chip = h('span', { class: 'hud-swatch__chip', 'aria-hidden': 'true' });
    if (color.hex) chip.style.setProperty('--swatch', color.hex);
    return chip;
  });
  const names = colors.map((color, i) => h('span', { class: 'hud-sr', id: `${id}-${i}-name`, text: color.name }));
  const el = h('fieldset', { class: 'hud-setting hud-swatches', id },
    h('legend', { class: 'hud-setting__name', text: label }),
    h('div', { class: 'hud-swatches__list' }, ...colors.map((color, i) => h('label', { class: 'hud-swatch', for: `${id}-${i}` }, inputs[i], chips[i], names[i]))));
  return {
    el,
    /** @param {number} index */
    set(index) {
      inputs.forEach((input, i) => (input.checked = i === index));
    },
    /** Swatches others hold, with who holds them; they cannot be chosen. @param {Map<number, string>} taken */
    disable(taken) {
      inputs.forEach((input, i) => {
        input.disabled = taken.has(i);
        names[i].textContent = taken.has(i) ? `${colors[i].name} (${taken.get(i)}'s)` : colors[i].name;
      });
    },
    /** @param {number} index @param {string} hex */
    recolor(index, hex) {
      chips[index].style.setProperty('--swatch', hex);
    },
  };
}
