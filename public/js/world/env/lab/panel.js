// Control panel for the environment lab. Every control is a native, labelled form element.
import { BUILDINGS, BUILDING_KEYS } from '../../../core/catalog.js';

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string>} [attrs]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

/** @param {string} legend @param {HTMLElement} parent */
function group(legend, parent) {
  const fs = el('fieldset', { class: 'env-lab__group' });
  fs.append(el('legend', {}, legend));
  parent.append(fs);
  return fs;
}

/** @param {HTMLElement} parent @param {string} label @param {() => void} onClick */
function button(parent, label, onClick) {
  const b = el('button', { type: 'button' }, label);
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
}

/**
 * @template {HTMLElement} T
 * @param {HTMLElement} parent @param {string} id @param {string} label @param {T} control
 * @returns {T}
 */
function labelled(parent, id, label, control) {
  control.id = id;
  const row = el('div', { class: 'env-lab__row' });
  row.append(el('label', { for: id }, label), control);
  parent.append(row);
  return control;
}

/** @returns {HTMLSelectElement} */
function buildingSelect() {
  const select = el('select');
  for (const key of BUILDING_KEYS) select.append(el('option', { value: key }, `${BUILDINGS[key].icon} ${BUILDINGS[key].name}`));
  return select;
}

/**
 * @param {HTMLElement} root
 * @param {ReturnType<typeof import('../environment.js').createEnvironment>} env
 * @param {{samples: {board: any[], stats: Record<string, string>}, status: HTMLElement}} opts
 * @returns {(fps: number, calls: number, triangles: number) => void} updates the readout
 */
export function buildPanel(root, env, opts) {
  const heading = el('h2', {}, 'Environment lab');
  root.append(heading);
  const out = el('p', { class: 'env-lab__readout', role: 'status' }, '…');
  root.append(out, opts.status);
  timeControls(group('Time and quality', root), env);
  cameraControls(group('Camera', root), env);
  buildingControls(group('Buildings', root), env, opts.samples.stats);
  featureControls(group('Board, node_modules and worktrees', root), env, opts.samples.board);
  vehicleControls(group('Vehicles', root), env);
  return (fps, calls, triangles) => {
    out.textContent = `${fps} fps · ${calls} draw calls · ${(triangles / 1000).toFixed(0)}k triangles · ${env.getTimeOfDay().toFixed(2)} h`;
  };
}

/** @param {HTMLElement} fs @param {any} env */
function timeControls(fs, env) {
  const slider = el('input', { type: 'range', min: '0', max: '24', step: '0.25' });
  slider.value = String(env.getTimeOfDay());
  labelled(fs, 'lab-time', 'Time of day (hours)', slider);
  const auto = el('input', { type: 'checkbox' });
  labelled(fs, 'lab-auto', 'Follow the local clock', auto);
  slider.addEventListener('input', () => {
    auto.checked = false;
    env.setTimeOfDay(Number(slider.value));
  });
  auto.addEventListener('change', () => env.setTimeOfDay(auto.checked ? 'auto' : Number(slider.value)));
  const quality = el('select');
  quality.append(el('option', { value: 'high' }, 'High'), el('option', { value: 'low' }, 'Low'));
  quality.value = new URLSearchParams(location.search).get('q') === 'low' ? 'low' : 'high';
  labelled(fs, 'lab-quality', 'Quality', quality).addEventListener('change', () => env.setQuality(/** @type {any} */ (quality.value)));
  const reduced = el('input', { type: 'checkbox' });
  labelled(fs, 'lab-reduced', 'Reduced motion', reduced).addEventListener('change', () => env.setReducedMotion(reduced.checked));
}

/** @param {HTMLElement} fs @param {any} env */
function cameraControls(fs, env) {
  const row = el('div', { class: 'env-lab__buttons' });
  button(row, '⟲ Rotate left', () => env.rotateCamera(-1));
  button(row, 'Rotate right ⟳', () => env.rotateCamera(1));
  button(row, 'Zoom in', () => env.zoomBy(1.4));
  button(row, 'Zoom out', () => env.zoomBy(1 / 1.4));
  button(row, 'Reset camera', () => env.resetCamera());
  fs.append(row);
  const target = labelled(fs, 'lab-focus', 'Focus on', buildingSelect());
  const row2 = el('div', { class: 'env-lab__buttons' });
  button(row2, 'Focus', () => env.focus(env.buildings[target.value].center, { zoom: 2.6 }));
  button(row2, 'Follow orbiting point', () => {
    const start = performance.now();
    env.focus({ x: 0, y: 0, z: 0 }, {
      zoom: 2,
      follow: () => {
        const t = (performance.now() - start) / 4000;
        return { x: Math.cos(t) * 12, y: 0.5, z: Math.sin(t) * 12 };
      },
    });
  });
  button(row2, 'Stop following', () => env.stopFollow());
  fs.append(row2);
}

/** @param {HTMLElement} fs @param {any} env @param {Record<string, string>} stats */
function buildingControls(fs, env, stats) {
  const target = labelled(fs, 'lab-building', 'Building', buildingSelect());
  const color = labelled(fs, 'lab-pulse-color', 'Pulse colour', el('input', { type: 'color', value: '#2457d6' }));
  const statText = labelled(fs, 'lab-stat', 'Sign stat', el('input', { type: 'text', value: '12 calls', maxlength: '40' }));
  const row = el('div', { class: 'env-lab__buttons' });
  button(row, 'Pulse', () => env.pulseBuilding(target.value, color.value));
  button(row, 'Highlight', () => env.highlightBuilding(target.value));
  button(row, 'Clear highlight', () => env.highlightBuilding(null));
  button(row, 'Set stat', () => env.setBuildingStat(target.value, statText.value));
  button(row, 'Clear stat', () => env.setBuildingStat(target.value, null));
  button(row, 'Sample stats', () => {
    for (const [key, text] of Object.entries(stats)) env.setBuildingStat(key, text);
  });
  fs.append(row);
}

/** @param {HTMLElement} fs @param {any} env @param {any[]} sample */
function featureControls(fs, env, sample) {
  let items = sample.map((it) => ({ ...it }));
  const row = el('div', { class: 'env-lab__buttons' });
  button(row, 'Sample goals', () => {
    items = sample.map((it) => ({ ...it }));
    env.setBoard(items, 'Fix the login bug');
  });
  button(row, 'Advance a goal', () => {
    const next = items.find((it) => it.status !== 'completed');
    if (next) next.status = next.status === 'pending' ? 'in_progress' : 'completed';
    env.setBoard(items, 'Fix the login bug');
  });
  button(row, 'Add a long goal', () => {
    items.push({ text: `Refactor the payment reconciliation worker so retries are idempotent (${items.length + 1})`, status: 'pending' });
    env.setBoard(items, 'Fix the login bug');
  });
  button(row, 'Clear board', () => {
    items = [];
    env.setBoard(items);
  });
  fs.append(row);
  const level = labelled(fs, 'lab-nm', 'node_modules pile (0–5)', el('input', { type: 'range', min: '0', max: '5', step: '1', value: '0' }));
  level.addEventListener('input', () => env.setNodeModules(Number(level.value)));
  const name = labelled(fs, 'lab-wt', 'Worktree name', el('input', { type: 'text', value: 'feature/login', maxlength: '60' }));
  /** @type {string[]} */
  const ids = [];
  const row2 = el('div', { class: 'env-lab__buttons' });
  button(row2, 'Add worktree', () => {
    const id = `wt-${Date.now()}`;
    ids.push(id);
    env.addWorktree(id, name.value);
  });
  button(row2, 'Remove last worktree', () => {
    const id = ids.pop();
    if (id) env.removeWorktree(id);
  });
  fs.append(row2);
}

/** @param {HTMLElement} fs @param {any} env */
function vehicleControls(fs, env) {
  const row = el('div', { class: 'env-lab__buttons' });
  for (const kind of ['bus', 'mailtruck', 'boat']) {
    for (const action of ['arrive', 'depart', 'trip']) {
      const label = `${kind === 'mailtruck' ? 'Mail truck' : kind === 'bus' ? 'Bus' : 'Boat'} ${action}`;
      button(row, label, () => env.vehicle(kind, action));
    }
  }
  fs.append(row);
}
