// The Tasks panel: for each crew, its goal (the latest prompt), a progress bar, and its todo list
// and shared team tasks with status marks.
import { h, renderList, setAttr, setHidden, setText, srOnly } from './dom.js';
import { icon } from './icons.js';
import { progressOf, truncate } from './format.js';
import { roundel, updateRoundel } from './parts.js';
import { shownNumber } from '../core/crew-board.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').Session} Session */
/** @typedef {{ key: string, text: string, status: string, owner?: string }} Item */

const ITEM_STATUS_WORDS = { completed: 'done', in_progress: 'in progress', pending: 'to do' };

/** @param {HudContext} ctx */
export function createTasksPanel(ctx) {
  const empty = h('p', { class: 'hud-empty' });
  const list = h('ol', { class: 'hud-goals' });
  const el = h('div', { class: 'hud-tasks', 'data-testid': 'tasks-panel' }, h('h2', { class: 'hud-sr', text: 'Tasks' }), empty, list);
  /** @type {WeakMap<HTMLElement, any>} */
  const parts = new WeakMap();

  /** @param {Session} session */
  function createGoal(session) {
    const mark = roundel(0, session.color);
    const project = h('h3', { class: 'hud-goal__project' });
    const tally = h('span', { class: 'hud-goal__tally' });
    const goal = h('p', { class: 'hud-goal__text' });
    const fill = h('span', { class: 'hud-meter__fill' });
    const meter = h('div', { class: 'hud-meter', 'aria-hidden': 'true' }, fill);
    const todosHeading = h('h4', { class: 'hud-goal__sub', text: 'Todo list' });
    const todos = h('ul', { class: 'hud-items' });
    const tasksHeading = h('h4', { class: 'hud-goal__sub', text: 'Team tasks' });
    const tasks = h('ul', { class: 'hud-items' });
    const item = h('li', { class: 'hud-goal' }, h('div', { class: 'hud-goal__head' }, mark, project, tally), goal, meter, todosHeading, todos, tasksHeading, tasks);
    parts.set(item, { mark, project, tally, goal, meter, fill, todosHeading, todos, tasksHeading, tasks });
    return item;
  }

  /** @param {HTMLElement} item @param {Session} session @param {number} number */
  function updateGoal(item, session, number) {
    const p = parts.get(item);
    updateRoundel(p.mark, number, session.color);
    setText(p.project, session.project);
    setText(p.goal, session.goal ? truncate(session.goal, 280) : 'No prompt yet');
    p.goal.classList.toggle('is-placeholder', !session.goal);
    const todos = session.todos.map((todo, index) => ({ key: `t${index}:${todo.text}`, text: todo.text, status: todo.status }));
    const tasks = session.tasks.map((task) => ({ key: `k${task.id}`, text: task.subject, status: task.status, owner: task.owner }));
    const all = [...todos, ...tasks];
    const { done, total, ratio } = progressOf(all);
    setText(p.tally, total ? `${done} of ${total} done` : '');
    setHidden(p.meter, !total);
    const scale = ratio.toFixed(3);
    if (p.fill.style.transform !== `scaleX(${scale})`) p.fill.style.transform = `scaleX(${scale})`;
    setHidden(p.todosHeading, !todos.length || !tasks.length);
    setHidden(p.tasksHeading, !todos.length || !tasks.length);
    renderList(p.todos, todos, (it) => it.key, createItem, updateItem);
    renderList(p.tasks, tasks, (it) => it.key, createItem, updateItem);
  }

  /** @param {StoreState} state */
  function render(state) {
    const shown = state.sessions.filter((session) => session.goal || session.todos.length || session.tasks.length);
    // Crews still at work first; ended crews keep their record below.
    shown.sort((a, b) => Number(a.status === 'ended') - Number(b.status === 'ended'));
    setText(empty, ctx.view.mode === 'demo' ? 'Goals and todo lists appear here as the demo crews plan their work.' : 'Each crew’s goal, todo list and team tasks appear here once it starts planning.');
    setHidden(empty, shown.length > 0);
    renderList(list, shown, (session) => session.id, createGoal, (item, session) => updateGoal(item, session, shownNumber(session)));
  }

  return { el, render };
}

/** @param {Item} it */
function createItem(it) {
  const mark = h('span', { class: 'hud-item__mark', 'aria-hidden': 'true' });
  const text = h('span', { class: 'hud-item__text' });
  const owner = h('span', { class: 'hud-item__owner' });
  const status = srOnly('');
  return h('li', { class: 'hud-item', 'data-testid': 'task-item', 'data-status': it.status }, mark, text, owner, status);
}

/** @param {HTMLElement} el @param {Item} it */
function updateItem(el, it) {
  const [mark, text, owner, status] = /** @type {HTMLElement[]} */ (Array.from(el.children));
  if (el.dataset.status !== it.status || !mark.firstChild) {
    el.dataset.status = it.status;
    mark.replaceChildren(itemMark(it.status));
  }
  setText(text, it.text);
  // Long items are cut to two lines on screen; the full text stays available on hover.
  setAttr(el, 'title', it.text.length > 70 ? it.text : null);
  setText(owner, it.owner ? it.owner : '');
  setHidden(owner, !it.owner);
  setText(status, `, ${ITEM_STATUS_WORDS[it.status] ?? 'to do'}`);
}

/** Done = tick in a disc, in progress = half-filled ring, to do = empty ring. @param {string} status */
function itemMark(status) {
  if (status === 'completed') return icon('check', { size: 14, className: 'hud-item__icon' });
  return h('span', { class: status === 'in_progress' ? 'hud-ring hud-ring--half' : 'hud-ring' });
}
