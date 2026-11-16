// The DOM overlay above the canvas: a name pill per agent (crew colour, cursor glyph, status dot,
// optional badge chip), one speech bubble and emote pops. It is decorative (aria-hidden): the HUD
// carries the same information as text. Text only ever goes in via textContent, and styles only
// via classes and CSSOM properties (the CSP forbids inline style attributes).

import { ensureContrastWithWhite } from './color.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATUSES = ['working', 'waiting', 'idle', 'error', 'done'];
/** Gap (CSS px) between a bubble and the pill under it, mirrored in world.css. */
export const BUBBLE_GAP = 6;

/** @param {string} tag @param {string} className @param {HTMLElement} [parent] */
function el(tag, className, parent) {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
}

/** The little mouse-pointer arrow on the pill's corner, as in the reference design. */
function cursorGlyph() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'tt-pill__cursor');
  svg.setAttribute('viewBox', '0 0 12 14');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M1 1 L1 12 L4.4 9 L6.8 13.6 L8.9 12.6 L6.6 8.1 L11 7.8 Z');
  svg.appendChild(path);
  return svg;
}

export class AgentTag {
  /**
   * @param {HTMLElement} root  overlay root
   * @param {string} id
   * @param {(id: string) => void} onPick  called when the pill is clicked
   */
  constructor(root, id, onPick) {
    this.el = el('div', 'tt-tag');
    this.el.dataset.agentId = id;
    const stack = el('div', 'tt-tag__stack', this.el);
    this.bubble = el('div', 'tt-bubble', stack);
    this.pill = el('div', 'tt-pill', stack);
    this.pill.appendChild(cursorGlyph());
    this.status = el('span', 'tt-pill__status tt-pill__status--idle', this.pill);
    this.name = el('span', 'tt-pill__name', this.pill);
    this.badge = el('span', 'tt-pill__badge', this.pill);
    this.badge.hidden = true;
    this.emoteEl = el('div', 'tt-emote', this.pill); // beside the pill's corner, whatever its width
    this.pill.addEventListener('click', () => onPick(id));
    root.appendChild(this.el);
    /** Last written placement, so unchanged frames touch no DOM. */
    this.x = NaN;
    this.y = NaN;
    this.scale = NaN;
    this.visible = true;
    this.bubbleShown = false;
    this.bubbleW = 0;
    this.bubbleH = 0;
    this.shift = 0;
    this.statusName = 'idle';
    this.depth = NaN;
    this.selected = false;
    this.hovered = false;
    /** Shrunk to its status dot because it sits in a crowd (decided by tags.js each frame). */
    this.compact = false;
    /** Pill width (CSS px), measured when its content changes. */
    this.pillW = 60;
  }

  /** Re-measures the pill after its name or badge changed (one layout read, not per frame). */
  measurePill() {
    this.pillW = this.pill.offsetWidth || this.pillW;
  }

  /** @param {string} name */
  setName(name) {
    this.name.textContent = name;
    this.measurePill();
  }

  /** @param {string} color crew hex */
  setColor(color) {
    this.el.style.setProperty('--crew', ensureContrastWithWhite(color));
  }

  /** @param {string} status */
  setStatus(status) {
    const next = STATUSES.includes(status) ? status : 'idle';
    if (next === this.statusName) return;
    this.status.classList.replace(`tt-pill__status--${this.statusName}`, `tt-pill__status--${next}`);
    this.statusName = next;
  }

  /** @param {string|null} text */
  setBadge(text) {
    this.badge.hidden = !text;
    this.badge.textContent = text ?? '';
    this.measurePill();
  }

  /** @param {boolean} on */
  setSelected(on) {
    this.selected = on;
    this.el.classList.toggle('is-selected', on);
    this.setDepth(this.depth, true);
  }

  /**
   * Stacks tags like the figures they belong to: lower on screen (nearer the camera) on top.
   * Bucketed so a walking agent rewrites its z-index only now and then. The selected tag wins,
   * and full pills beat shrunk ones.
   * @param {number} screenY @param {boolean} [force]
   */
  setDepth(screenY, force = false) {
    const bucket = Math.round(screenY / 6);
    if (!force && bucket === this.depth) return;
    this.depth = bucket;
    // Full pills sit above shrunk ones so a dot never covers a readable name.
    const lift = (this.selected ? 100000 : 0) + (this.compact ? 0 : 50000);
    this.el.style.zIndex = String((Number.isFinite(bucket) ? Math.max(0, bucket) : 0) + lift);
  }

  /** @param {boolean} on */
  setHovered(on) {
    this.hovered = on;
    this.el.classList.toggle('is-hovered', on);
  }

  /** @param {boolean} on */
  setCompact(on) {
    if (on === this.compact) return;
    this.compact = on;
    this.el.classList.toggle('is-compact', on);
    this.setDepth(this.depth, true);
  }

  /**
   * Shows (or replaces) the bubble and measures it for the de-overlap pass.
   * @param {string} text  already truncated
   * @param {string} tone
   * @param {boolean} reducedMotion
   */
  showBubble(text, tone, reducedMotion) {
    this.bubble.textContent = text;
    this.bubble.className = `tt-bubble tt-bubble--${tone} is-visible`;
    this.bubbleShown = true;
    this.bubbleW = this.bubble.offsetWidth;
    this.bubbleH = this.bubble.offsetHeight;
    if (!reducedMotion) {
      this.bubble.animate([{ scale: '0.6', opacity: 0 }, { scale: '1.06', opacity: 1, offset: 0.7 }, { scale: '1' }], {
        duration: 220,
        easing: 'ease-out',
      });
    }
  }

  hideBubble() {
    this.bubble.classList.remove('is-visible');
    this.bubbleShown = false;
    this.setBubbleShift(0);
  }

  /**
   * Pops an emoji above the head.
   * @param {string} emoji @param {boolean} reducedMotion
   */
  emote(emoji, reducedMotion) {
    this.emoteEl.textContent = emoji;
    const frames = reducedMotion
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: 'translateY(6px) scale(0.2)' },
          { opacity: 1, transform: 'translateY(-10px) scale(1.25)', offset: 0.18 },
          { opacity: 1, transform: 'translateY(-16px) scale(1)', offset: 0.7 },
          { opacity: 0, transform: 'translateY(-30px) scale(0.9)' },
        ];
    this.emoteEl.animate(frames, { duration: 1700, easing: 'ease-out', fill: 'forwards' });
  }

  /**
   * Moves the tag to a screen point (the top of the agent's head). Writes only on change.
   * @param {number} x @param {number} y CSS px in the container
   * @param {number} scale @param {boolean} visible
   */
  place(x, y, scale, visible) {
    if (visible !== this.visible) {
      this.el.classList.toggle('is-offscreen', !visible);
      this.visible = visible;
    }
    if (!visible) return;
    if (Math.abs(x - this.x) < 0.25 && Math.abs(y - this.y) < 0.25 && Math.abs(scale - this.scale) < 0.004) return;
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
  }

  /** Vertical shift of the bubble from the de-overlap pass, in unscaled px. @param {number} dy */
  setBubbleShift(dy) {
    if (Math.abs(dy - this.shift) < 0.5) return;
    this.shift = dy;
    this.bubble.style.translate = `0 ${dy.toFixed(1)}px`;
  }

  remove() {
    this.el.remove();
  }
}

/**
 * Creates the overlay root inside the world container.
 * @param {HTMLElement} container
 */
export function createOverlay(container) {
  const root = el('div', 'tt-agents');
  root.setAttribute('aria-hidden', 'true');
  container.appendChild(root);
  return {
    root,
    /** @param {string} id @param {(id: string) => void} onPick */
    createTag: (id, onPick) => new AgentTag(root, id, onPick),
    /** @param {boolean} on */
    setReducedMotion(on) {
      root.classList.toggle('tt-agents--still', on);
    },
    dispose() {
      root.remove();
    },
  };
}
