// The "You" dialog (CONTRACTS §4.11): a person of a team town chooses their character's whole
// look, their colour, their home's style, the name their character shows and one name for all
// their agents, with a live preview, Random, Undo and a few ready-made outfits. Opened from
// Settings. Every choice is a grid of picture tiles (the option drawn on the character, cropped
// to the part it changes) in a radio group with a legend, in six sections behind tabs, so arrow
// keys, screen readers (each tile is named) and phones (44 px tiles) all work. Saving sends the
// profile (live: to the team host; demo: to the demo's people), waits for the answer, and keeps
// a copy in this browser, sent again after a `team reset` forgets it.
import { nameWithRoster } from './town-people.js';
import { CREW_COLORS } from '../core/catalog.js';
import { LOOKS } from '../core/looks.js';
import {
  CLOTH_COLORS, HAIR_COLORS, LOOK_CHOICES, NAME_MAX_CHARS, OUTFITS, PERSON_COLOR_NAMES, SKIN_TONES,
  cleanDisplayName, defaultProfile, randomLook, validateProfile,
} from '../core/profile.js';
import { createDialog } from './dialogs.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { characterSvg, drawPreview } from './character-preview.js';

/** @typedef {import('../core/profile.js').Profile} Profile */
/** @typedef {import('../core/profile.js').PersonLook} PersonLook */
/** @typedef {import('./town-people.js').PersonView} PersonView */
/** @typedef {keyof typeof import('./character-preview.js').CROPS} Crop */

/** Where this browser keeps its own profile, to send again after a `team reset`. */
const STORAGE_KEY = 'andary:profile';
/** How many earlier looks Undo goes back through. */
const UNDO_DEPTH = 30;

/** Words for the enumerated choices. */
const WORDS = Object.freeze({
  short: 'Short', medium: 'Medium', tall: 'Tall', slim: 'Slim', regular: 'Regular', broad: 'Broad',
  side: 'Side part', quiff: 'Quiff', spiky: 'Spiky', straight: 'Long straight', wavy: 'Long wavy', ponytail: 'Ponytail',
  pigtails: 'Pigtails', bun: 'Bun', braids: 'Braids', afro: 'Afro', curly: 'Curly', mohawk: 'Mohawk', buzz: 'Buzz cut', bald: 'Bald',
  dot: 'Dots', round: 'Round', happy: 'Happy', sleepy: 'Sleepy', lashes: 'Lashes', wink: 'Wink',
  none: 'None', thin: 'Thin', thick: 'Thick', arched: 'Arched',
  smile: 'Smile', grin: 'Grin', neutral: 'Neutral', open: 'Open',
  stubble: 'Stubble', beard: 'Beard', goatee: 'Goatee', moustache: 'Moustache',
  square: 'Square', sunglasses: 'Sunglasses', goggles: 'Goggles',
  freckles: 'Freckles', blush: 'Blush', both: 'Freckles and blush', studs: 'Studs', hoops: 'Hoops',
  tee: 'T-shirt', longsleeve: 'Long sleeves', hoodie: 'Hoodie', zip: 'Zip jacket', denim: 'Denim jacket', bomber: 'Bomber',
  blazer: 'Blazer', shirt: 'Shirt', polo: 'Polo', tank: 'Tank top', sweater: 'Sweater', cardigan: 'Cardigan',
  vest: 'Vest and shirt', labcoat: 'Lab coat', overalls: 'Overalls', dress: 'Dress', kimono: 'Kimono',
  plain: 'Plain', stripes: 'Stripes', checks: 'Checks', dots: 'Dots', emblem: 'Emblem',
  trousers: 'Trousers', jeans: 'Jeans', cargo: 'Cargo', shorts: 'Shorts', skirt: 'Skirt', longskirt: 'Long skirt', joggers: 'Joggers',
  sneakers: 'Sneakers', hightops: 'High-tops', boots: 'Boots', sandals: 'Sandals', loafers: 'Loafers', slippers: 'Slippers',
  cap: 'Cap', beanie: 'Beanie', beret: 'Beret', sunhat: 'Sun hat', wizard: 'Wizard hat', crown: 'Crown', hardhat: 'Hard hat',
  bucket: 'Bucket hat', headband: 'Headband', bandana: 'Bandana', flowers: 'Flower crown', viking: 'Viking helmet',
  tophat: 'Top hat', chef: 'Chef\'s hat', halo: 'Halo',
  cape: 'Cape', scarf: 'Scarf', backpack: 'Backpack', headphones: 'Headphones', tie: 'Tie', bowtie: 'Bow tie',
  necklace: 'Necklace', watch: 'Watch', satchel: 'Satchel', wings: 'Wings',
  cat: 'Cat', dog: 'Dog', bird: 'Bird', laptop: 'Laptop', coffee: 'Coffee', book: 'Book',
});

/** @param {string} value */
const word = (value) => /** @type {Record<string, string>} */ (WORDS)[value] ?? value;
/** Plural things that take no "a". */
const PLURAL = new Set(['headphones', 'wings', 'sunglasses', 'goggles', 'hoops', 'studs', 'overalls', 'jeans', 'shorts', 'trousers', 'joggers', 'sneakers', 'boots', 'sandals', 'loafers', 'slippers', 'hightops', 'cargo']);
/** @param {string} value */
const thing = (value) => `${PLURAL.has(value) ? '' : 'a '}${word(value).toLowerCase()}`;

/**
 * One sentence for screen readers (the preview's label) and the dialog's status.
 * @param {Profile} profile
 * @returns {string}
 */
export function describeLook(profile) {
  const l = profile.look;
  const color = (/** @type {'theme'|number} */ c) => (c === 'theme' ? PERSON_COLOR_NAMES[profile.color] : CLOTH_COLORS[c].name).toLowerCase();
  const hair = l.hair === 'bald' ? 'bald' : `${HAIR_COLORS[l.hairColor].name.toLowerCase()} ${word(l.hair).toLowerCase()} hair${l.hairStreak === 'none' ? '' : ` with ${HAIR_COLORS[l.hairStreak].name.toLowerCase()} streaks`}`;
  const glasses = l.glasses === 'round' || l.glasses === 'square' ? `${l.glasses} glasses` : l.glasses === 'none' ? '' : word(l.glasses).toLowerCase();
  const face = [l.facialHair === 'none' ? '' : thing(l.facialHair), glasses].filter(Boolean);
  const pattern = l.topPattern === 'plain' ? '' : ` with ${color(l.patternColor)} ${word(l.topPattern).toLowerCase()}`;
  const wearing = [`${color(l.topColor)} ${word(l.top).toLowerCase()}${pattern}`, `${CLOTH_COLORS[l.bottomColor].name.toLowerCase()} ${word(l.bottom).toLowerCase()}`, `${CLOTH_COLORS[l.shoesColor].name.toLowerCase()} ${word(l.shoes).toLowerCase()}`];
  const extras = [l.hat, l.extra].filter((v) => v !== 'none').map(thing);
  const pet = l.pet === 'none' ? '' : `, with a ${word(l.pet).toLowerCase()}`;
  const hand = l.hand === 'none' ? '' : `, holding ${thing(l.hand)}`;
  const listing = [...face, ...extras];
  return `${word(l.height)}, ${word(l.build).toLowerCase()}, ${SKIN_TONES[l.skin].name.toLowerCase()} skin, ${hair}${listing.length ? `, ${listing.join(', ')}` : ''}; wearing ${wearing.join(', ')}${pet}${hand}.`;
}

/** @returns {Profile|null} this browser's saved profile, if it is still valid */
export function loadSavedProfile() {
  try {
    const check = validateProfile(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null'));
    return check.ok ? /** @type {Profile} */ (check.profile) : null;
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

/**
 * A choice of one field: its tiles draw the character with that option, cropped to `crop`; or,
 * for a palette, a colour chip.
 * @typedef {object} FieldSpec
 * @property {keyof PersonLook|'color'|'house'} field
 * @property {string} label
 * @property {Crop} [crop]
 * @property {'theme'|'none'} [extra]  a palette's first tile: the person's own colour, or none
 */

/** @type {ReadonlyArray<{ id: string, name: string, fields: FieldSpec[] }>} */
const SECTIONS = Object.freeze([
  { id: 'body', name: 'Body', fields: [{ field: 'skin', label: 'Skin' }, { field: 'height', label: 'Height', crop: 'whole' }, { field: 'build', label: 'Build', crop: 'top' }] },
  { id: 'hair', name: 'Hair', fields: [{ field: 'hair', label: 'Hairstyle', crop: 'head' }, { field: 'hairColor', label: 'Hair colour' }, { field: 'hairStreak', label: 'Streaks and tips', extra: 'none' }] },
  { id: 'face', name: 'Face', fields: [
    { field: 'eyes', label: 'Eyes', crop: 'head' }, { field: 'brows', label: 'Eyebrows', crop: 'head' }, { field: 'mouth', label: 'Mouth', crop: 'head' },
    { field: 'facialHair', label: 'Facial hair', crop: 'head' }, { field: 'glasses', label: 'Glasses', crop: 'head' },
    { field: 'cheeks', label: 'Cheeks', crop: 'head' }, { field: 'earrings', label: 'Earrings', crop: 'head' },
  ] },
  { id: 'clothes', name: 'Clothes', fields: [
    { field: 'top', label: 'Top', crop: 'top' }, { field: 'topPattern', label: 'Pattern', crop: 'top' }, { field: 'topColor', label: 'Top colour', extra: 'theme' },
    { field: 'patternColor', label: 'Pattern colour', extra: 'theme' }, { field: 'bottom', label: 'Bottoms', crop: 'bottom' },
    { field: 'bottomColor', label: 'Bottoms colour' }, { field: 'shoes', label: 'Shoes', crop: 'feet' }, { field: 'shoesColor', label: 'Shoes colour' },
  ] },
  { id: 'extras', name: 'Accessories', fields: [{ field: 'hat', label: 'Hat', crop: 'head' }, { field: 'extra', label: 'Extra', crop: 'whole' }, { field: 'pet', label: 'Pet', crop: 'whole' }, { field: 'hand', label: 'In your hand', crop: 'hand' }] },
  { id: 'home', name: 'Home and names', fields: [{ field: 'color', label: 'Your colour' }, { field: 'house', label: 'Your home' }] },
]);

/** House styles drawn small: walls, roof and door. */
const HOUSE_TILES = Object.freeze({ coast: ['#F6C9C0', '#E2704F'], snow: ['#B5413A', '#EEF3F7'], neon: ['#2C2645', '#52EAFF'], desert: ['#E0B48A', '#D3A171'], amman: ['#EADFC8', '#D9A441'] });

/**
 * @param {import('./types.js').HudContext} ctx
 */
export function createCharacterDialog(ctx) {
  /** @type {Profile} */
  let draft = defaultProfile(0);
  /** @type {Profile[]} */
  let history = [];
  /** The profile sent and not answered yet: the dialog stays open until the town says. @type {Profile|null} */
  let pending = null;
  let section = SECTIONS[0].id;
  const preview = h('div', { class: 'hud-character__preview', role: 'img' });
  const caption = h('p', { class: 'hud-character__caption', 'aria-hidden': 'true' });
  const status = h('p', { class: 'hud-setting__help', role: 'status', 'data-testid': 'character-status' });

  const theme = () => CREW_COLORS[draft.color];
  /** @type {Map<string, ReturnType<typeof tileGroup>>} */
  const groups = new Map();
  for (const spec of SECTIONS.flatMap((s) => s.fields)) groups.set(spec.field, tileGroup(spec, () => draft, theme, (value) => change(spec.field, value)));

  const names = nameFields(() => draft, (patch) => update(patch, false));
  const outfits = outfitRow((outfit) => {
    update({ look: { ...draft.look, ...outfit.look } });
    status.textContent = `${outfit.name} outfit: ${describeLook(draft)}`;
  });
  const panels = SECTIONS.map((s) => h('div', { role: 'tabpanel', class: 'hud-character__panel', id: `hud-char-panel-${s.id}`, 'aria-labelledby': `hud-char-tab-${s.id}` },
    s.id === 'clothes' ? h('div', { class: 'hud-setting' }, h('p', { class: 'hud-setting__name', text: 'Ready-made outfits' }), outfits.el) : null,
    ...s.fields.map((f) => /** @type {any} */ (groups.get(f.field)).el),
    s.id === 'home' ? names.el : null));
  const { tablist, tabs } = sectionTabs((id) => showSection(id));

  const { random, undo, save, cancel } = editButtons();
  random.addEventListener('click', () => {
    update({ look: randomLook() });
    status.textContent = `New look: ${describeLook(draft)}`;
  });
  undo.addEventListener('click', () => {
    const previous = history.pop();
    if (!previous) return;
    draft = previous;
    show();
    status.textContent = 'Undone.';
  });
  save.addEventListener('click', () => {
    if (pending) return;
    draft = { ...draft, name: cleanDisplayName(names.value('name')), agents: cleanDisplayName(names.value('agents')) };
    pending = draft;
    status.textContent = 'Saving…';
    if (!ctx.controls.saveProfile?.(draft)) {
      pending = null;
      status.textContent = 'Not saved: the town is not connected right now. Try again in a moment.';
    }
  });
  cancel.addEventListener('click', () => dialog.close());

  const dialog = createDialog({
    id: 'hud-character',
    title: 'You',
    wide: true,
    body: [
      h('div', { class: 'hud-character' },
        h('div', { class: 'hud-character__stage' }, preview, caption, h('div', { class: 'hud-character__undo' }, random, undo)),
        h('div', { class: 'hud-character__form' },
          h('p', { class: 'hud-dialog__lead', text: 'Choose how your character looks in the team town, its colour, your home and your names. Everyone sees the same.' }),
          tablist, ...panels)),
      status,
      h('div', { class: 'hud-dialog__actions' }, cancel, save),
    ],
  });
  dialog.el.dataset.testid = 'character-dialog';

  /**
   * @param {string} field @param {unknown} value
   */
  function change(field, value) {
    if (field === 'color' || field === 'house') update({ [field]: value });
    else update({ look: { ...draft.look, [field]: value } });
  }

  /** @param {Partial<Profile>} patch @param {boolean} [redraw] */
  function update(patch, redraw = true) {
    history = [...history, draft].slice(-UNDO_DEPTH);
    draft = { ...draft, ...patch };
    if (redraw) show();
    else undo.disabled = false;
  }

  /** @param {string} id */
  function showSection(id) {
    section = id;
    tabs.forEach((tab, i) => {
      const on = SECTIONS[i].id === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    show();
  }

  /** Draws the preview and the open section's tiles, and sets every control from the draft. */
  function show() {
    const people = /** @type {PersonView[]} */ (ctx.view.people ?? []);
    const taken = new Map(people.filter((p) => p.name !== ctx.view.me).map((p) => [p.color, nameWithRoster(p)]));
    for (const s of SECTIONS) for (const f of s.fields) /** @type {any} */ (groups.get(f.field)).render(s.id === section, taken);
    if (section === 'clothes') outfits.render(draft, theme());
    names.set(draft);
    drawPreview(preview, draft, theme());
    preview.setAttribute('aria-label', `Preview of your character: ${describeLook(draft)}`);
    caption.textContent = `${cleanDisplayName(names.value('name')) || ctx.view.me || 'You'}, home: ${LOOKS.find((l) => l.id === draft.house)?.name ?? ''}`;
    undo.disabled = history.length === 0;
  }

  return {
    el: dialog.el,
    close: dialog.close,
    get isOpen() {
      return dialog.isOpen;
    },
    /** Whether a save waits for the town's answer. */
    get pending() { return pending !== null; },
    /** The town saved it: kept in this browser too, and the dialog closes. */
    saved() {
      if (!pending) return;
      saveLocally(pending);
      pending = null;
      dialog.close();
    },
    /** The town refused it: said in the dialog, which stays open. @param {string} message */
    refused(message) {
      pending = null;
      status.textContent = message;
    },
    /** Someone else's colour changed while the dialog is open. */
    peopleChanged: () => dialog.isOpen && show(),
    open() {
      pending = null;
      history = [];
      draft = initialDraft(ctx);
      names.reset(draft, ctx.view.me ?? 'You');
      status.textContent = '';
      showSection(section);
      dialog.open();
    },
  };
}

function editButtons() {
  return {
    random: h('button', { type: 'button', class: 'hud-btn', 'data-testid': 'character-random' }, icon('repeat', { size: 18 }), 'Random'),
    undo: /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'hud-btn', 'data-testid': 'character-undo' }, 'Undo')),
    save: h('button', { type: 'button', class: 'hud-btn hud-btn--primary', 'data-testid': 'character-save' }, icon('check', { size: 18 }), 'Save'),
    cancel: h('button', { type: 'button', class: 'hud-btn' }, 'Cancel'),
  };
}

/**
 * What the dialog opens with: the person's profile on the host, else the one kept in this
 * browser, else the default in their colour.
 * @param {import('./types.js').HudContext} ctx
 * @returns {Profile}
 */
function initialDraft(ctx) {
  const people = /** @type {PersonView[]} */ (ctx.view.people ?? []);
  const mine = people.find((p) => p.name === ctx.view.me);
  return mine?.profile ? { ...mine.profile, color: mine.color } : (loadSavedProfile() ?? defaultProfile(mine?.color ?? 0));
}

/**
 * The section tabs: arrow keys, Home and End move between them (one tab stop).
 * @param {(id: string) => void} onShow
 */
function sectionTabs(onShow) {
  const tabs = SECTIONS.map((s) => h('button', { type: 'button', role: 'tab', class: 'hud-character__tab', id: `hud-char-tab-${s.id}`, 'aria-controls': `hud-char-panel-${s.id}`, text: s.name }));
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => onShow(SECTIONS[i].id));
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[/** @type {KeyboardEvent} */ (event).key];
      if (step === undefined) return;
      event.preventDefault();
      const next = (i + step + tabs.length) % tabs.length;
      onShow(SECTIONS[next].id);
      tabs[next].focus();
    });
  });
  return { tablist: h('div', { role: 'tablist', class: 'hud-character__tabs', 'aria-label': 'Parts of your character' }, ...tabs), tabs };
}

/**
 * The ready-made outfits, as picture buttons over the person's own body, hair and face.
 * @param {(outfit: typeof OUTFITS[number]) => void} onPick
 */
function outfitRow(onPick) {
  const buttons = OUTFITS.map((outfit) => {
    const button = h('button', { type: 'button', class: 'hud-tile hud-tile--button', 'data-outfit': outfit.id }, h('span', { class: 'hud-tile__art', 'aria-hidden': 'true' }), h('span', { class: 'hud-tile__name', text: outfit.name }));
    button.addEventListener('click', () => onPick(outfit));
    return button;
  });
  return {
    el: h('div', { class: 'hud-character__outfits', role: 'group', 'aria-label': 'Ready-made outfits' }, ...buttons),
    /** @param {Profile} profile @param {string} theme */
    render(profile, theme) {
      buttons.forEach((button, i) => button.firstElementChild?.replaceChildren(characterSvg({ ...profile, look: { ...profile.look, ...OUTFITS[i].look } }, theme, 'whole')));
    },
  };
}

/**
 * A radio group of picture tiles for one field.
 * @param {FieldSpec} spec
 * @param {() => Profile} current
 * @param {() => string} theme
 * @param {(value: unknown) => void} onChange
 */
function tileGroup(spec, current, theme, onChange) {
  const id = `hud-char-${spec.field}`;
  const options = optionsOf(spec);
  const choice = h('span', { class: 'hud-tiles__choice', 'aria-hidden': 'true' });
  const tiles = options.map((option, i) => {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: id, id: `${id}-${i}`, value: String(i), class: 'hud-tile__input' }));
    input.addEventListener('change', () => {
      if (input.checked) onChange(option.value);
    });
    const art = h('span', { class: `hud-tile__art${option.swatch !== undefined ? ' hud-tile__art--swatch' : ''}`, 'aria-hidden': 'true' });
    const name = h('span', { class: 'hud-tile__name', text: option.name });
    const label = h('label', { class: 'hud-tile', for: `${id}-${i}`, title: option.name }, input, art, name);
    return { input, art, name, label, option };
  });
  const el = h('fieldset', { class: 'hud-setting hud-tiles', id, 'data-field': spec.field },
    h('legend', { class: 'hud-setting__name' }, spec.label, ': ', choice),
    h('div', { class: `hud-tiles__list${options[0]?.swatch !== undefined ? ' hud-tiles__list--swatches' : ''}` }, ...tiles.map((t) => t.label)));
  return {
    el,
    /**
     * Marks the chosen tile and, when its section is open, draws the tiles.
     * @param {boolean} visible @param {Map<number, string>} taken  person colours others hold, and whose
     */
    render(visible, taken) {
      const profile = current();
      const value = spec.field === 'color' || spec.field === 'house' ? profile[spec.field] : profile.look[/** @type {keyof PersonLook} */ (spec.field)];
      for (const tile of tiles) {
        tile.input.checked = tile.option.value === value;
        if (tile.input.checked) choice.textContent = tile.option.name;
        if (spec.field === 'color') {
          const holder = taken.get(/** @type {number} */ (tile.option.value));
          tile.input.disabled = holder !== undefined;
          tile.name.textContent = holder ? `${tile.option.name} (${holder}'s)` : tile.option.name;
        }
        if (!visible) continue;
        if (tile.option.swatch !== undefined) tile.art.style.setProperty('--swatch', tile.option.swatch || theme());
        else if (spec.field === 'house') tile.art.replaceChildren(houseSvg(/** @type {string} */ (tile.option.value)));
        else tile.art.replaceChildren(characterSvg({ ...profile, look: { ...profile.look, [spec.field]: tile.option.value } }, theme(), spec.crop ?? 'whole'));
      }
    },
  };
}

/**
 * A field's options: value, visible name, and a colour for a palette.
 * @param {FieldSpec} spec
 * @returns {{ value: unknown, name: string, swatch?: string }[]}
 */
function optionsOf(spec) {
  if (spec.field === 'color') return CREW_COLORS.map((hex, i) => ({ value: i, name: PERSON_COLOR_NAMES[i], swatch: hex }));
  if (spec.field === 'house') return LOOKS.map((look) => ({ value: look.id, name: look.name }));
  const choices = LOOK_CHOICES[/** @type {keyof typeof LOOK_CHOICES} */ (spec.field)];
  if (typeof choices[0] === 'string') return /** @type {readonly string[]} */ (choices).map((value) => ({ value, name: word(value) }));
  const palette = /** @type {ReadonlyArray<import('../core/profile.js').Swatch>} */ (choices).map((s, i) => ({ value: /** @type {unknown} */ (i), name: s.name, swatch: s.hex }));
  if (spec.extra === 'theme') return [{ value: 'theme', name: 'Your colour', swatch: '' }, ...palette];
  if (spec.extra === 'none') return [{ value: 'none', name: 'None', swatch: 'transparent' }, ...palette];
  return palette;
}

/** A small house in a style. @param {string} style */
function houseSvg(style) {
  const [wall, roof] = /** @type {Record<string, string[]>} */ (HOUSE_TILES)[style] ?? HOUSE_TILES.coast;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', 'hud-character__svg');
  const shapes = [
    ['rect', { x: 8, y: 18, width: 24, height: 16, fill: wall }],
    style === 'coast' || style === 'snow' ? ['path', { d: 'M5 19 L20 7 L35 19 Z', fill: roof }] : ['rect', { x: 7, y: 15, width: 26, height: 4, fill: roof }],
    style === 'amman' ? ['path', { d: 'M20 15 A6 6 0 0 1 32 15 Z', fill: roof }] : null,
    ['rect', { x: 12, y: 24, width: 6, height: 10, fill: '#6B4A2E' }],
    ['rect', { x: 22, y: 23, width: 6, height: 5, fill: '#2A4258' }],
  ];
  for (const shape of shapes) {
    if (!shape) continue;
    const el = document.createElementNS('http://www.w3.org/2000/svg', /** @type {string} */ (shape[0]));
    for (const [k, v] of Object.entries(/** @type {Record<string, string|number>} */ (shape[1]))) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

/**
 * The two names: the character's, and one for all the person's agents.
 * @param {() => Profile} current
 * @param {(patch: Partial<Profile>) => void} onChange
 */
function nameFields(current, onChange) {
  const field = (/** @type {'name'|'agents'} */ key, /** @type {string} */ label, /** @type {string} */ help) => {
    const id = `hud-char-${key}-input`;
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'text', class: 'hud-input', id, maxlength: String(NAME_MAX_CHARS * 2), autocomplete: 'off', spellcheck: 'false' }));
    input.addEventListener('change', () => {
      input.value = cleanDisplayName(input.value);
      onChange({ [key]: input.value });
    });
    const el = h('div', { class: 'hud-setting' }, h('div', { class: 'hud-setting__row' }, h('label', { class: 'hud-setting__name', for: id, text: label }), input), h('p', { class: 'hud-setting__help', id: `${id}-help`, text: help }));
    input.setAttribute('aria-describedby', `${id}-help`);
    return { el, input };
  };
  const name = field('name', 'Your character\'s name', `On your name pill and your home's plate: up to ${NAME_MAX_CHARS} letters, digits, spaces, dots or dashes. Empty: your name on the team.`);
  const agents = field('agents', 'One name for all your agents', 'Your crews\' helpers become this name and a number ("Pixel 1", "Pixel 2"), and a lead your character does not play this name. Empty: their role names (Foreman, Scout 1…). Their role still shows in their details.');
  return {
    el: h('div', {}, name.el, agents.el),
    /** @param {'name'|'agents'} key */
    value: (key) => (key === 'name' ? name : agents).input.value,
    /** @param {Profile} profile */
    set(profile) {
      if (document.activeElement !== name.input) name.input.value = profile.name;
      if (document.activeElement !== agents.input) agents.input.value = profile.agents;
    },
    /** @param {Profile} profile @param {string} me */
    reset(profile, me) {
      name.input.value = profile.name;
      agents.input.value = profile.agents;
      name.input.placeholder = me;
      agents.input.placeholder = 'Foreman, Scout 1, Builder 2…';
    },
    current,
  };
}
