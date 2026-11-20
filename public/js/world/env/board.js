// The Goal Board's face: the session's task list drawn on a canvas texture (title bar, progress,
// one row per task with a status tick, wrapped text, "+N more"). Redrawn only when the list
// changes (and once the web font has loaded).
import * as THREE from 'three';
import { BOARD_PANEL } from './buildings/grounds.js';
import { layoutBoard } from './board-text.js';
import { LOT_Y } from './terrain.js';

const W = 1024;
const H = Math.round((W * BOARD_PANEL.h) / BOARD_PANEL.w);
const HEADER = 118;
const PAD = 44;
const LINE = 64;
const TEXT_X = 116;
const FONT = '600 46px Overpass, system-ui, sans-serif';
const FONT_BOLD = '800 46px Overpass, system-ui, sans-serif';

/** @typedef {import('./board-text.js').BoardItem} BoardItem */

/**
 * @param {{record: import('./buildings/index.js').BuildingRecord, scene: THREE.Scene}} deps
 */
export function createBoard({ record, scene }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.15,
    roughness: 0.85,
  });
  material.name = 'goal-board';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_PANEL.w, BOARD_PANEL.h), material);
  mesh.name = 'goal-board-face';
  const p = BOARD_PANEL;
  mesh.position.set(record.lot.cx + p.x + Math.sin(p.rotY) * 0.035, LOT_Y + p.y, record.lot.cz + p.z + Math.cos(p.rotY) * 0.035);
  mesh.rotation.y = p.rotY;
  mesh.receiveShadow = true;
  record.root.attach(mesh);
  /** @type {BoardItem[]} */
  let items = [];
  let title = '';
  let dirty = true;
  document.fonts?.ready.then(() => {
    dirty = true;
  });

  return {
    /** @param {BoardItem[]} next @param {string} [nextTitle] */
    set(next, nextTitle) {
      items = Array.isArray(next) ? next.map((it) => ({ text: it?.text, status: it?.status })) : [];
      title = typeof nextTitle === 'string' ? nextTitle : '';
      dirty = true;
    },
    /** @param {number} night 0..1: the board's own lamp keeps it readable after dark */
    setNight(night) {
      material.emissiveIntensity = 0.15 + 0.55 * night;
    },
    update() {
      if (!dirty) return;
      dirty = false;
      draw(g, items, title);
      texture.needsUpdate = true;
    },
    dispose() {
      record.root.remove(mesh);
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {BoardItem[]} items
 * @param {string} title
 */
function draw(g, items, title) {
  g.fillStyle = '#fbf6ea';
  g.fillRect(0, 0, W, H);
  g.font = FONT;
  const layout = layoutBoard(/** @type {any} */ (items), {
    title,
    maxWidth: W - TEXT_X - PAD,
    maxLines: Math.floor((H - HEADER - PAD - 30) / LINE),
    measure: (s) => g.measureText(s).width,
  });
  drawHeader(g, layout.title, layout.summary);
  if (!layout.rows.length) {
    g.fillStyle = '#6b7685';
    g.font = '700 40px Overpass, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('No goals yet', W / 2, HEADER + (H - HEADER) / 2);
    g.font = '600 28px Overpass, system-ui, sans-serif';
    g.fillText('Todo lists and tasks are pinned here', W / 2, HEADER + (H - HEADER) / 2 + 44);
    g.textAlign = 'left';
    return;
  }
  let y = HEADER + PAD;
  for (const row of layout.rows) {
    drawStatus(g, row.status, PAD + 22, y + LINE / 2 - 2);
    row.lines.forEach((line, i) => drawLine(g, line, row.status, y + i * LINE));
    y += row.lines.length * LINE;
  }
  if (layout.more > 0) {
    g.fillStyle = '#6b7685';
    g.font = '700 38px Overpass, system-ui, sans-serif';
    g.fillText(`+${layout.more} more`, TEXT_X, y + 36);
  }
}

/** @param {CanvasRenderingContext2D} g @param {string} title @param {string} summary */
function drawHeader(g, title, summary) {
  g.fillStyle = '#1f6f69';
  g.fillRect(0, 0, W, HEADER);
  g.fillStyle = '#ffffff';
  g.font = '800 56px Overpass, system-ui, sans-serif';
  g.textBaseline = 'middle';
  const summaryWidth = 300;
  let text = `📋 ${title}`;
  while (text.length > 4 && g.measureText(text).width > W - PAD * 2 - summaryWidth) text = `${text.slice(0, -2)}…`;
  g.fillText(text, PAD, HEADER / 2 + 4);
  g.font = '700 36px Overpass, system-ui, sans-serif';
  g.textAlign = 'right';
  g.fillStyle = '#d9f3ef';
  g.fillText(summary, W - PAD, HEADER / 2 + 4);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  // Pins in the corners make it read as a noticeboard.
  for (const x of [22, W - 22]) {
    g.fillStyle = '#d64b3c';
    g.beginPath();
    g.arc(x, HEADER + 22, 9, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {string} line
 * @param {string} status
 * @param {number} top
 */
function drawLine(g, line, status, top) {
  const baseline = top + LINE / 2 + 14;
  g.font = status === 'in_progress' ? FONT_BOLD : FONT;
  g.fillStyle = status === 'completed' ? '#7d8794' : status === 'in_progress' ? '#14202f' : '#2b3546';
  g.fillText(line, TEXT_X, baseline);
  if (status === 'completed') {
    const width = g.measureText(line).width;
    g.fillRect(TEXT_X, baseline - 15, width, 4);
  }
}

/**
 * Status mark: green tick, amber half-filled ring, or an empty grey ring.
 * @param {CanvasRenderingContext2D} g
 * @param {string} status
 * @param {number} x @param {number} y centre
 */
function drawStatus(g, status, x, y) {
  const r = 21;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  if (status === 'completed') {
    g.fillStyle = '#2f9e6b';
    g.fill();
    g.strokeStyle = '#ffffff';
    g.beginPath();
    g.moveTo(x - 10, y + 1);
    g.lineTo(x - 3, y + 8);
    g.lineTo(x + 11, y - 7);
    g.stroke();
    return;
  }
  g.strokeStyle = status === 'in_progress' ? '#e09a2d' : '#a3abb5';
  g.stroke();
  if (status === 'in_progress') {
    g.fillStyle = '#e09a2d';
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, r - 5, -Math.PI / 2, Math.PI / 2);
    g.closePath();
    g.fill();
  }
}
