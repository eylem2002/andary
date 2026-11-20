// Where the place labels go and what they show, decided in screen space. Pure (no DOM, no
// three.js), so the rules are unit-tested; env/signs.js projects, measures and writes.
//
// The rules, in order of importance:
//  1. Agents come first. A label never covers a figure standing in front of its place: it fades
//     out and lets clicks through until the figure has moved on. Only the pointer resting on the
//     label itself keeps it readable (the viewer is reading it).
//  2. A label stays on its own place. It is drawn inside the building's outline on screen and
//     never moves up into the street behind, where the next building's agents stand.
//  3. A name is shown only when it fits on its building at this zoom ('auto'), with its stat chip
//     when that fits too, otherwise just the icon. 'always' shows names anyway; 'off' shows
//     nothing. Hovered and selected places always show their name, and worktree tags (data, not
//     place names) always show, stacked when they meet.
//  4. When two labels collide, the one nearer the camera keeps its place; the farther one drops
//     its stat, then shrinks to its icon, and hides if even that collides. ('always' writes every
//     name, nearer on top.)

/** @typedef {import('../../core/place-names.js').PlaceNames} PlaceNames */
/** @typedef {'full'|'name'|'icon'|'hidden'} LabelState  full: name and stat chip */

/** Px a name must clear before it appears, and may overflow before it goes: no flicker at the edge. */
export const FIT_MARGIN = 4;
/** Px kept between two labels. */
export const LABEL_GAP = 3;

/** The forms a label can take, largest first; a label tries them from the one it wants down. */
const LADDER = /** @type {const} */ (['full', 'name', 'icon']);

/**
 * @typedef {object} LabelBox
 * @property {'building'|'decor'|'tree'} kind
 * @property {number} x        screen x of the anchor (px)
 * @property {number} y        screen y of the anchor (px): the centre for 'center', the bottom edge for 'bottom'
 * @property {'center'|'bottom'} align
 * @property {number} wFull    width with the name and stat chip, at scale 1 (px); wName when there is no stat
 * @property {number} wName    width with the name, at scale 1 (px)
 * @property {number} wIcon    width as an icon alone, at scale 1 (0: no icon form)
 * @property {number} h        height at scale 1 (px)
 * @property {number} room     width of the place on screen (px); Infinity when it does not matter
 * @property {number} depth    larger is farther from the camera
 * @property {number} ground   screen y of the place's ground (px): figures whose feet are above it stand behind
 * @property {boolean} focused hovered or selected: shows its name whatever the mode
 * @property {boolean} held    the pointer rests on the label itself: never fades
 * @property {boolean} visible on screen this frame
 * @property {LabelState} state  in: last frame's; out: this frame's
 * @property {number} left     out: the box as placed (px)
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 */

/**
 * @typedef {object} FigureBox
 * @property {number} x     centre (px)
 * @property {number} y     top of the head (px)
 * @property {number} feet  bottom (px)
 * @property {number} half  half the width (px)
 */

/** @param {LabelBox} box @param {'full'|'name'|'icon'} state */
function widthOf(box, state) {
  return state === 'full' ? box.wFull : state === 'name' ? box.wName : box.wIcon;
}

/**
 * Whether a form fits on the place, with some slack for the form the label already shows.
 * @param {LabelBox} box @param {'full'|'name'} form @param {number} scale
 */
function fits(box, form, scale) {
  const showing = box.state === form || (form === 'name' && box.state === 'full');
  return widthOf(box, form) * scale <= box.room + (showing ? FIT_MARGIN : -FIT_MARGIN);
}

/**
 * What a label would like to show before collisions are considered.
 * @param {LabelBox} box
 * @param {PlaceNames} mode
 * @param {number} scale
 * @returns {LabelState}
 */
export function wantedState(box, mode, scale) {
  if (box.focused || box.held || box.kind === 'tree') return 'full';
  if (mode === 'off') return 'hidden';
  if (mode === 'always') return 'full';
  if (fits(box, 'full', scale)) return 'full';
  if (fits(box, 'name', scale)) return 'name';
  return box.wIcon > 0 ? 'icon' : 'hidden';
}

/** Placing order: focused first, then worktree tags, then nearest the camera. @param {LabelBox} a @param {LabelBox} b */
function placeFirst(a, b) {
  const pa = a.focused || a.held ? 2 : a.kind === 'tree' ? 1 : 0;
  const pb = b.focused || b.held ? 2 : b.kind === 'tree' ? 1 : 0;
  return pb - pa || a.depth - b.depth;
}

/**
 * Sets a box's rectangle for a state at a scale.
 * @param {LabelBox} box @param {'full'|'name'|'icon'} state @param {number} scale
 */
function frame(box, state, scale) {
  const w = widthOf(box, state) * scale;
  const h = box.h * scale;
  box.left = box.x - w / 2;
  box.right = box.x + w / 2;
  box.bottom = box.align === 'center' ? box.y + h / 2 : box.y;
  box.top = box.bottom - h;
}

/** @param {LabelBox} a @param {LabelBox} b */
function clash(a, b) {
  return a.left < b.right + LABEL_GAP && b.left < a.right + LABEL_GAP && a.top < b.bottom + LABEL_GAP && b.top < a.bottom + LABEL_GAP;
}

/**
 * Worktree tags are data and always show: one that meets another moves up above it, within the
 * grove (tags are placed before every building label, so only tags and focused labels are there).
 * @param {LabelBox} box @param {LabelBox[]} placed @param {number} count
 */
function stack(box, placed, count) {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let j = 0; j < count; j++) {
      const other = placed[j];
      if (!clash(box, other)) continue;
      const lift = box.bottom - (other.top - LABEL_GAP);
      box.y -= lift;
      box.top -= lift;
      box.bottom -= lift;
      moved = true;
    }
    if (!moved) break;
  }
}

/**
 * Decides every label's state and rectangle for this frame. Allocation-free once `order` has
 * grown to `boxes.length` entries.
 * @param {LabelBox[]} boxes
 * @param {PlaceNames} mode
 * @param {number} scale
 * @param {LabelBox[]} order  scratch
 * @returns {LabelBox[]} the shown boxes, in placing order (`order` itself)
 */
export function placeLabels(boxes, mode, scale, order) {
  order.length = 0;
  for (const box of boxes) {
    if (box.visible) order.push(box);
    else box.state = 'hidden';
  }
  order.sort(placeFirst);
  let shown = 0;
  for (let i = 0; i < order.length; i++) {
    const box = order[i];
    const want = wantedState(box, mode, scale);
    box.state = 'hidden';
    if (want === 'hidden') continue;
    if (box.kind === 'tree') {
      frame(box, 'full', scale);
      stack(box, order, shown);
      box.state = 'full';
    } else {
      // Focused labels, and every name in 'always', go where they are, even over another: the
      // viewer is looking at them, or chose to see them all.
      const anyway = box.focused || box.held || mode === 'always';
      for (let k = LADDER.indexOf(want); k < LADDER.length; k++) {
        const state = LADDER[k];
        if (state === 'icon' && box.wIcon <= 0) break;
        frame(box, state, scale);
        let free = true;
        for (let j = 0; j < shown && free && !anyway; j++) free = !clash(box, order[j]);
        if (free) {
          box.state = state;
          break;
        }
      }
    }
    if (box.state === 'hidden') continue;
    // Keep shown boxes at the front of `order`, so later boxes only test against them.
    order[i] = order[shown];
    order[shown++] = box;
  }
  order.length = shown;
  return order;
}

/**
 * Whether a figure stands in front of a placed label: its feet are on this side of the place's
 * ground and its body crosses the label.
 * @param {LabelBox} box
 * @param {ReadonlyArray<FigureBox>} figures
 */
export function coversFigure(box, figures) {
  if (box.held) return false;
  for (const f of figures) {
    if (f.feet < box.ground) continue; // behind the place: the building itself hides it
    if (f.x + f.half > box.left && f.x - f.half < box.right && f.y < box.bottom && f.feet > box.top) return true;
  }
  return false;
}
