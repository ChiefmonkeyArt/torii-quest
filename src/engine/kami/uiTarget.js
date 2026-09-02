// uiTarget.js — ADR-0025. Describe the DOM control under the pointer.
//
// This is the "point at a button > create ema" half of Kami Mode. It exists as a
// separate pure module because it needs NO live DOM: every function takes an
// element-LIKE object (id/tagName/className/textContent/getBoundingClientRect)
// so the selector and label logic is unit-testable with plain fakes, instead of
// only being exercisable by hand in a browser.
//
// WHY THIS WORKS AT ALL: Torii Quest's menus are static markup in index.html
// toggled with classList (roughly a hundred stable ids), NOT geometry drawn into
// the WebGL canvas. So `document.elementFromPoint()` returns a real, identifiable
// element with a durable id. A canvas-drawn UI would have made this impossible
// without hit-testing bespoke widget geometry.

// Elements that carry no meaning on their own. When the pointer lands on one we
// walk up to the nearest meaningful ancestor, so noting a button never records
// the anonymous <span> holding its label.
const TRANSPARENT_TAGS = new Set(['span', 'b', 'i', 'em', 'strong', 'svg', 'path', 'g', 'use', 'img']);

// Tags worth stopping on immediately: they are what a person means by "control".
const CONTROL_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'summary']);

const MAX_CLIMB = 6;

function tagOf(el) {
  return String((el && el.tagName) || '').toLowerCase();
}

/** className can be a string or an SVGAnimatedString; normalise both. */
function classListOf(el) {
  const raw = el && el.className;
  const str = typeof raw === 'string' ? raw : (raw && typeof raw.baseVal === 'string' ? raw.baseVal : '');
  return str.split(/\s+/).filter(Boolean);
}

/**
 * Climb from the hit element to the thing a human would say they pointed at.
 * Stops early on a real control or anything with an id; gives up after MAX_CLIMB
 * so a deep tree cannot walk all the way to <body> and record something useless.
 */
export function resolveTargetElement(el, maxClimb = MAX_CLIMB) {
  let cur = el;
  let steps = 0;
  while (cur && steps < maxClimb) {
    const tag = tagOf(cur);
    if (CONTROL_TAGS.has(tag)) return cur;
    if (cur.id) return cur;
    if (!TRANSPARENT_TAGS.has(tag)) {
      // A div/section with a class is meaningful enough to record, but keep
      // climbing past bare unclassed wrappers.
      if (classListOf(cur).length > 0) return cur;
    }
    cur = cur.parentElement || null;
    steps += 1;
  }
  return cur || el || null;
}

/**
 * Build a CSS selector for an element. An id yields a stable selector that
 * survives layout changes; a rect does not, which is why the selector is the
 * primary identity and the rect is only a hint.
 */
export function selectorFor(el) {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  const tag = tagOf(el) || 'unknown';
  const classes = classListOf(el)
    // Skip state classes: they describe the moment, not the element, and would
    // make the selector fail to match once the state changes.
    .filter((c) => !/^(show|hidden|active|open|selected|is-|has-)/.test(c))
    .slice(0, 2);
  const base = classes.length ? `${tag}.${classes.join('.')}` : tag;
  // Qualify with the nearest id'd ancestor so `button.btn` is not ambiguous
  // across a dozen screens.
  let parent = el.parentElement || null;
  let steps = 0;
  while (parent && steps < MAX_CLIMB) {
    if (parent.id) return `#${parent.id} ${base}`;
    parent = parent.parentElement || null;
    steps += 1;
  }
  return base;
}

/** Visible label text, collapsed and capped — how a human recognises the control. */
export function labelFor(el, maxLen = 80) {
  if (!el) return '';
  const raw = typeof el.textContent === 'string' ? el.textContent : '';
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, maxLen);
  // Icon-only controls have no text; fall back to the accessible name.
  const aria = el.getAttribute ? (el.getAttribute('aria-label') || el.getAttribute('title') || '') : '';
  return String(aria).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/**
 * Full description of a pointed-at control, ready for emaModel.normaliseUiTarget.
 *
 * @param {object} el     element-like ({ id, tagName, className, textContent, getBoundingClientRect })
 * @param {object} [opts] { phase } current game phase, for context
 */
export function describeUiTarget(el, opts = {}) {
  const target = resolveTargetElement(el);
  if (!target) return null;
  const out = {
    selector: selectorFor(target),
    tag: tagOf(target),
    text: labelFor(target),
  };
  if (opts.phase) out.phase = String(opts.phase);
  if (typeof target.getBoundingClientRect === 'function') {
    try {
      const r = target.getBoundingClientRect();
      if (r) out.rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    } catch { /* non-rendered element; rect is optional */ }
  }
  return out.selector ? out : null;
}
