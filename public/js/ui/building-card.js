// The card shown when a building is selected in the town: what happens there, how often it was
// visited, and which agents are there now (each one selectable).
import { BUILDINGS } from '../core/catalog.js';
import { h, renderList, setHidden, setText } from './dom.js';
import { BUILDING_ICONS, icon } from './icons.js';
import { plural } from './format.js';
import { statusChip, updateStatusChip } from './parts.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').AgentState} AgentState */

/** @param {HudContext} ctx */
export function createBuildingCard(ctx) {
  const glyph = h('span', { class: 'hud-place__icon', 'aria-hidden': 'true' });
  const title = h('h2', { class: 'hud-place__name', id: 'hud-place-title', tabindex: '-1' });
  const close = h('button', { type: 'button', class: 'hud-iconbtn', 'aria-label': 'Close building details' }, icon('close'));
  const blurb = h('p', { class: 'hud-place__blurb' });
  const stat = h('p', { class: 'hud-place__stat' });
  const here = h('h3', { class: 'hud-place__here' });
  const agents = h('ul', { class: 'hud-place__agents' });
  const el = h('section', { class: 'hud hud-place', 'aria-labelledby': 'hud-place-title', hidden: true },
    h('div', { class: 'hud-place__head' }, glyph, title, close), blurb, stat, here, agents);

  /** @type {string|null} */
  let buildingKey = null;
  close.addEventListener('click', () => ctx.select(null));

  /** @param {string} key @param {{ focus?: boolean }} [options] */
  function open(key, { focus = false } = {}) {
    if (!BUILDINGS[key]) return;
    buildingKey = key;
    glyph.replaceChildren(icon(BUILDING_ICONS[key] ?? 'info', { size: 22 }));
    setHidden(el, false);
    render(ctx.store.getState());
    if (focus) title.focus();
  }

  function hide() {
    buildingKey = null;
    setHidden(el, true);
  }

  /** @param {StoreState} state */
  function render(state) {
    if (!buildingKey) return;
    const info = BUILDINGS[buildingKey];
    setText(title, info.name);
    setText(blurb, info.blurb);
    const visits = state.stats.byBuilding?.[buildingKey] ?? 0;
    setText(stat, visits ? `${plural(visits, 'visit')} so far` : 'No visits yet');
    const present = Object.values(state.agents).filter((agent) => agent.building === buildingKey && agent.status !== 'done');
    setText(here, present.length ? `Here now: ${present.length}` : 'Nobody here right now');
    renderList(agents, present, (agent) => agent.key, createAgentButton, updateAgentButton);
  }

  /** @param {AgentState} agent */
  function createAgentButton(agent) {
    const button = h('button', { type: 'button', class: 'hud-place__agent' }, statusChip(agent.status), h('span', { class: 'hud-place__agent-name' }));
    button.addEventListener('click', () => ctx.select({ type: 'agent', id: agent.key }, { camera: true }));
    return h('li', {}, button);
  }

  /** @param {HTMLElement} item @param {AgentState} agent */
  function updateAgentButton(item, agent) {
    updateStatusChip(/** @type {HTMLElement} */ (item.querySelector('.hud-chip')), agent.status);
    setText(/** @type {HTMLElement} */ (item.querySelector('.hud-place__agent-name')), agent.name);
  }

  return { el, open, hide, render, get buildingKey() { return buildingKey; } };
}
