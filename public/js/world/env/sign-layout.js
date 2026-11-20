// Where the place labels go and what they show, decided in screen space. Pure (no DOM, no
// three.js), so the rules are unit-tested; env/signs.js projects, measures and writes.
//
// The rules, in order of importance:
//  1. Agents come first. A label never covers a figure standing in front of its place: it fades
//     out and lets clicks through until the figure has moved on.
//  2. A label stays on its own place. It is drawn inside the building's outline on screen and
//     never moves up into the street behind, where the next building's agents stand.
//  3. A name is shown only when it fits on its building at this zoom ('auto'), otherwise just the
//     icon. 'always' shows names anyway; 'off' shows nothing. Hovered and selected places always
//     show their name, and worktree tags (data, not place names) always show.
//  4. When two labels collide, the one nearer the camera keeps its place; the farther one shrinks
//     to its icon, and hides if even that collides. ('always' writes every name, nearer on top.)

/** @typedef {import('../../core/place-names.js').PlaceNames} PlaceNames */

/** Px a name must clear before it appears, and may overflow before it goes: no flicker at the edge. */
export const FIT_MARGIN = 4;
/** Px kept between two labels. */
export const LABEL_GAP = 3;

/**
 * @typedef {object} LabelBox
 * @property {'building'|'decor'|'tree'} kind
 * @property {number} x        screen x of the anchor (px)
 * @property {number} y        screen y of the anchor (px): the centre for 'center', the bottom edge for 'bottom'
 * @property {'center'|'bottom'} align
 * @property {number} wName    width with the name, at scale 1 (px)
 * @property {number} wIcon    width as an icon alone, at scale 1 (0: no icon form)
 * @property {number} h        height at scale 1 (px)
 * @property {number} room     width of the place on screen (px); Infinity when it does not matter
 * @property {number} depth    larger is farther from the camera
 * @property {number} ground   screen y of the place's ground (px): figures whose feet are above it stand behind it
 * @property {boolean} focused hovered or selected
 * @property {boolean} visible on screen this frame
 * @property {'name'|'icon'|'hidden'} state  in: last frame's; out: this frame's
 * @property {boolean} faded   out: a figure stands in front of it
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

/**
 * What a label would like to show before collisions are considered.
 * @param {LabelBox} box
 * @param {PlaceNames} mode
 * @param {number} scale
 * @returns {'name'|'icon'|'hidden'}
 */
export function wantedState(box, mode, scale) {
  if (box.focused || box.kind === 'tree') return 'name';
  if (mode === 'off') return 'hidden';
  if (mode === 'always') return 'name';
  const margin = box.state === 'name' ? FIT_MARGIN : -FIT_MARGIN;
  if (box.wName * scale <= box.room + margin) return 'name';
  return box.wIcon > 0 ? 'icon' : 'hidden';
}

/** Placing order: focused first, then worktree tags, then nearest the camera. @param {LabelBox} a @param {LabelBox} b */
function placeFirst(a, b) {
  const pa = a.focused ? 2 : a.kind === 'tree' ? 1 : 0;
  const pb = b.focused ? 2 : b.kind === 'tree' ? 1 : 0;
  return pb - pa || a.depth - b.depth;
}

/**
 * Sets each box's rectangle for a state at a scale.
 * @param {LabelBox} box @param {'name'|'icon'} state @param {number} scale
 */
function frame(box, state, scale) {
  const w = (state === 'name' ? box.wName : box.wIcon) * scale;
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
 * Decides every label's state and rectangle for this frame. Allocation-free once `order` is
 * large enough (it must hold `boxes.length` entries).
 * @param {LabelBox[]} boxes
 * @param {PlaceNames} mode
 * @param {number} scale
 * @param {LabelBox[]} order  scratch
 * @returns {LabelBox[]} the shown boxes, in placing order (a prefix of `order`)
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
    // Focused labels go where they are, even over another: the viewer is looking at them. So does
    // every name in 'always', which the viewer chose.
    const anyway = box.focused || mode === 'always';
    for (const state of want === 'name' && box.wIcon > 0 && !anyway ? /** @type {const} */ (['name', 'icon']) : [want]) {
      frame(box, state, scale);
      let free = true;
      for (let j = 0; j < shown && free && !anyway; j++) free = !clash(box, order[j]);
      if (free) {
        box.state = state;
        break;
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
  if (box.focused) return false;
  for (const f of figures) {
    if (f.feet < box.ground) continue; // behind the place: the building itself hides it
    if (f.x + f.half > box.left && f.x - f.half < box.right && f.y < box.bottom && f.feet > box.top) return true;
  }
  return false;
}
