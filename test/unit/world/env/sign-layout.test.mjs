import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FIT_MARGIN, coversFigure, placeLabels, wantedState } from '../../../../public/js/world/env/sign-layout.js';

/**
 * A label box with sensible defaults: a building label centred at (x, y), 100 px wide with its
 * name, 24 px as an icon, on a place 200 px wide.
 * @param {Partial<import('../../../../public/js/world/env/sign-layout.js').LabelBox>} [over]
 * @returns {import('../../../../public/js/world/env/sign-layout.js').LabelBox}
 */
function box(over = {}) {
  return {
    kind: 'building', x: 100, y: 100, align: 'center', wName: 100, wIcon: 24, h: 24, room: 200, depth: 0.5,
    ground: 140, focused: false, visible: true, state: 'hidden', faded: false, left: 0, top: 0, right: 0, bottom: 0,
    ...over,
  };
}

describe('wantedState', () => {
  test('auto shows a name only when it fits on its place, else the icon', () => {
    assert.equal(wantedState(box({ room: 200 }), 'auto', 1), 'name');
    assert.equal(wantedState(box({ room: 60 }), 'auto', 1), 'icon');
    // Zooming in grows the room on screen faster than the label (scale is gentle).
    assert.equal(wantedState(box({ room: 60 }), 'auto', 1.25), 'icon');
    assert.equal(wantedState(box({ room: 160 }), 'auto', 1.25), 'name');
  });

  test('the edge has some slack, so a zoom right at the threshold does not flicker', () => {
    const edge = box({ room: 100 + FIT_MARGIN / 2 });
    assert.equal(wantedState({ ...edge, state: 'icon' }, 'auto', 1), 'icon');
    assert.equal(wantedState({ ...edge, state: 'name' }, 'auto', 1), 'name');
  });

  test('always and off', () => {
    assert.equal(wantedState(box({ room: 10 }), 'always', 1), 'name');
    assert.equal(wantedState(box(), 'off', 1), 'hidden');
  });

  test('a hovered or selected place shows its name whatever the mode; worktree tags always show', () => {
    assert.equal(wantedState(box({ room: 10, focused: true }), 'off', 1), 'name');
    assert.equal(wantedState(box({ kind: 'tree', room: 10 }), 'off', 1), 'name');
  });

  test('a decor label without an icon hides rather than shrink', () => {
    assert.equal(wantedState(box({ kind: 'decor', wIcon: 0, room: 10 }), 'auto', 1), 'hidden');
  });
});

describe('placeLabels', () => {
  test('the label nearer the camera keeps its name; the farther one shrinks to its icon', () => {
    const near = box({ x: 100, depth: 0.2 });
    const far = box({ x: 180, depth: 0.6 }); // names overlap (100 px wide, 80 apart), icons do not
    const shown = placeLabels([far, near], 'auto', 1, []);
    assert.equal(near.state, 'name');
    assert.equal(far.state, 'icon');
    assert.equal(shown.length, 2);
  });

  test('a label that cannot fit even as an icon hides; it never moves up into the street', () => {
    const near = box({ x: 100, y: 100, depth: 0.2 });
    const far = box({ x: 105, y: 102, depth: 0.6 });
    placeLabels([near, far], 'auto', 1, []);
    assert.equal(far.state, 'hidden');
    assert.equal(far.y, 102);
  });

  test('always writes every name, even over another', () => {
    const near = box({ x: 100, depth: 0.2 });
    const far = box({ x: 105, depth: 0.6 });
    placeLabels([near, far], 'always', 1, []);
    assert.deepEqual([near.state, far.state], ['name', 'name']);
  });

  test('a focused label goes first and is never shrunk', () => {
    const near = box({ x: 100, depth: 0.2 });
    const hovered = box({ x: 175, depth: 0.6, focused: true });
    placeLabels([near, hovered], 'auto', 1, []);
    assert.equal(hovered.state, 'name');
    assert.equal(near.state, 'icon');
  });

  test('off-screen labels hide; rectangles follow the alignment and scale', () => {
    const away = box({ visible: false, state: 'name' });
    const tag = box({ kind: 'tree', align: 'bottom', x: 300, y: 300, wName: 80, h: 20 });
    placeLabels([away, tag], 'auto', 1.25, []);
    assert.equal(away.state, 'hidden');
    assert.equal(tag.state, 'name');
    assert.deepEqual([tag.left, tag.right, tag.top, tag.bottom], [250, 350, 275, 300]);
  });

  test('reuses the scratch array', () => {
    const scratch = [box(), box()];
    const shown = placeLabels([box({ x: 0 }), box({ x: 500 })], 'auto', 1, scratch);
    assert.equal(shown, scratch);
    assert.equal(shown.length, 2);
  });
});

describe('coversFigure', () => {
  const label = box({ x: 100, y: 100, ground: 140 });
  placeLabels([label], 'auto', 1, []); // name: 50–150 × 88–112

  test('a figure standing in front of the label fades it', () => {
    assert.equal(coversFigure(label, [{ x: 110, y: 90, feet: 150, half: 8 }]), true);
  });

  test('figures beside, above or below it do not', () => {
    assert.equal(coversFigure(label, [{ x: 200, y: 90, feet: 150, half: 8 }]), false);
    assert.equal(coversFigure(label, [{ x: 110, y: 120, feet: 160, half: 8 }]), false);
    assert.equal(coversFigure(label, [{ x: 110, y: 40, feet: 80, half: 8 }]), false);
  });

  test('a figure behind the place is hidden by the building, so the label stays', () => {
    assert.equal(coversFigure(label, [{ x: 110, y: 90, feet: 130, half: 8 }]), false);
  });

  test('a hovered or selected label stays readable', () => {
    assert.equal(coversFigure({ ...label, focused: true }, [{ x: 110, y: 90, feet: 150, half: 8 }]), false);
  });
});
