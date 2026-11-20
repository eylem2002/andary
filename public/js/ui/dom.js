// A tiny DOM builder for the HUD. Hook data comes from Claude Code sessions that read untrusted
// repositories, so dynamic text only ever reaches the page as text nodes / textContent — never
// through HTML parsing (the lint config bans the HTML sinks outright).

/** @typedef {Node|string|number|null|undefined|false|any[]} Child  arrays may nest */

/**
 * Creates an element. Props: `class`, `text` (textContent), `on` (event listeners), `value` and
 * `checked` (set as properties), anything else becomes an attribute (`true` → empty attribute,
 * `false`/`null`/`undefined` → omitted).
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name === 'text') el.textContent = String(value);
    else if (name === 'on') for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
    else if (name === 'value' || name === 'checked') /** @type {any} */ (el)[name] = value;
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

/**
 * Appends children (strings become text nodes; nested arrays are flattened; falsy values skipped).
 * @param {Element} parent
 * @param {Child[]} children
 */
export function append(parent, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (typeof child === 'string' || typeof child === 'number') parent.appendChild(document.createTextNode(String(child)));
    else parent.appendChild(child);
  }
}

/**
 * Sets textContent only when it changed, so a re-render of unchanged data does no DOM work.
 * @param {Element} el
 * @param {string} text
 */
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/**
 * Sets or removes an attribute only when the value changed.
 * @param {Element} el
 * @param {string} name
 * @param {string|null|undefined|boolean} value  null/undefined/false removes the attribute
 */
export function setAttr(el, name, value) {
  if (value == null || value === false) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
    return;
  }
  const next = value === true ? '' : String(value);
  if (el.getAttribute(name) !== next) el.setAttribute(name, next);
}

/**
 * Shows or hides an element with the `hidden` attribute.
 * @param {HTMLElement} el
 * @param {boolean} hidden
 */
export function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/**
 * Renders a keyed list: reuses the child element of each key, creates missing ones, removes stale
 * ones and only moves nodes that are out of order (moving a node would drop its focus).
 * @template T
 * @param {Element} parent        holds only keyed children
 * @param {T[]} items
 * @param {(item: T) => string} keyOf
 * @param {(item: T) => HTMLElement} create
 * @param {(el: HTMLElement, item: T, index: number) => void} update
 */
export function renderList(parent, items, keyOf, create, update) {
  const wanted = new Set(items.map(keyOf));
  /** @type {Map<string, HTMLElement>} */
  const existing = new Map();
  for (const child of Array.from(parent.children)) {
    const el = /** @type {HTMLElement} */ (child);
    if (wanted.has(el.dataset.key)) existing.set(el.dataset.key, el);
    else el.remove();
  }
  let cursor = parent.firstElementChild;
  items.forEach((item, index) => {
    const key = keyOf(item);
    let el = existing.get(key);
    if (!el) {
      el = create(item);
      el.dataset.key = key;
    }
    update(el, item, index);
    if (el === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(el, cursor);
  });
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Applies a crew colour as the `--crew` custom property. Colours come from the store; anything
 * that is not a plain hex colour is ignored so a malformed value can never inject CSS.
 * @param {HTMLElement} el
 * @param {string|undefined} color
 */
export function setCrewColor(el, color) {
  const value = color && HEX_COLOR.test(color) ? color : '#5D6874';
  if (el.style.getPropertyValue('--crew') !== value) el.style.setProperty('--crew', value);
}

/** A visually hidden span: text for screen readers that would be redundant on screen. */
export function srOnly(text) {
  return h('span', { class: 'hud-sr', text });
}
