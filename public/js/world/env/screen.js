// The big terminal screen on Terminal Works: a few lines of shell output and a blinking prompt,
// drawn on a canvas texture. Only the cursor cell is redrawn when it blinks.
import * as THREE from 'three';

const W = 512;
const H = 256;
const LINES = Object.freeze([
  ['#8be9fd', '$ npm test'],
  ['#d7e3f4', '> andary@1.0 test'],
  ['#50fa7b', '✓ 128 passing (2.4s)'],
  ['#d7e3f4', '$ git status --short'],
  ['#f1fa8c', ' M src/town.ts'],
]);
const PROMPT_Y = 214;
const CURSOR_X = 52;

/**
 * @returns {{texture: THREE.CanvasTexture, update: (dt: number) => void, dispose: () => void}}
 */
export function createTerminalScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let blink = 0;
  let on = true;

  function draw() {
    g.fillStyle = '#0d1520';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#16263a';
    g.fillRect(0, 0, W, 26);
    for (const [i, color] of ['#ff5f56', '#ffbd2e', '#27c93f'].entries()) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(18 + i * 20, 13, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.font = '600 26px "Overpass Mono", ui-monospace, monospace';
    g.textBaseline = 'alphabetic';
    LINES.forEach(([color, text], i) => {
      g.fillStyle = color;
      g.fillText(text, 16, 60 + i * 34);
    });
    g.fillStyle = '#8be9fd';
    g.fillText('$', 16, PROMPT_Y + 26);
    drawCursor();
  }

  function drawCursor() {
    g.fillStyle = on ? '#e8f1ff' : '#0d1520';
    g.fillRect(CURSOR_X, PROMPT_Y + 4, 16, 26);
    texture.needsUpdate = true;
  }

  draw();
  document.fonts?.ready.then(() => {
    draw();
  });
  return {
    texture,
    update(dt) {
      blink += dt;
      if (blink < 0.55) return;
      blink = 0;
      on = !on;
      drawCursor();
    },
    dispose() {
      texture.dispose();
    },
  };
}
