// DOM helpers for the lab's control panel: real buttons, selects and inputs with accessible
// names, built with createElement/textContent only.

/**
 * @param {HTMLElement} parent
 * @param {string} title
 * @returns {HTMLElement} the row that holds the section's controls
 */
export function section(parent, title) {
  const wrap = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const row = document.createElement('div');
  row.className = 'tt-lab__row';
  wrap.append(heading, row);
  parent.appendChild(wrap);
  return row;
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} [description] longer accessible description (title tooltip)
 */
export function button(parent, label, onClick, description) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (description) b.title = description;
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {string[]} options
 * @param {string} [value]
 * @returns {HTMLSelectElement}
 */
export function select(parent, label, options, value) {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const s = document.createElement('select');
  for (const option of options) {
    const o = document.createElement('option');
    o.value = option;
    o.textContent = option;
    s.appendChild(o);
  }
  if (value) s.value = value;
  wrap.appendChild(s);
  parent.appendChild(wrap);
  return s;
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {string} value
 * @returns {HTMLInputElement}
 */
export function textInput(parent, label, value) {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {(checked: boolean) => void} onChange
 */
export function checkbox(parent, label, onChange) {
  const wrap = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, document.createTextNode(label));
  parent.appendChild(wrap);
  return input;
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {{min: number, max: number, step: number, value: number}} range
 * @param {(value: number) => void} onInput
 */
export function slider(parent, label, range, onInput) {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(range.value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}
