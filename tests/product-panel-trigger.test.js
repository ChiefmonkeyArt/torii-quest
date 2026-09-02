// tests/product-panel-trigger.test.js — locks the ADR-0036 PROXIMITY → OPEN
// trigger (src/engine/world/productPanelTrigger.js) that drives the in-world
// PRODUCT sign's first-ever interaction. Proves: walking INTO range raises a
// prompt but never opens anything; walking OUT clears the prompt; only an
// explicit interact() opens (calls onOpen); out-of-range interact is a no-op;
// onPrompt fires only on range transitions; reset() clears without opening.
// Pure module → node-safe (no THREE/DOM/window reached).
import { describe, it, expect } from 'vitest';
import {
  PRODUCT_PANEL_PROMPT_TEXT, createProductPanelTrigger,
} from '../src/engine/world/productPanelTrigger.js';

const PANEL_POS = Object.freeze({ x: 5, y: 2, z: 31 });

function makeTrigger(extra = {}) {
  const prompts = [];
  const opens = [];
  const trigger = createProductPanelTrigger({
    panelPos: PANEL_POS,
    range: 3,
    onPrompt: (show, text) => prompts.push({ show, text }),
    onOpen: () => opens.push(true),
    ...extra,
  });
  return { trigger, prompts, opens };
}

describe('module shape', () => {
  it('pins the interact prompt text', () => {
    expect(PRODUCT_PANEL_PROMPT_TEXT).toBe('Press Q to view products');
  });
});

describe('proximity (tick) is inert — raises a prompt but NEVER opens', () => {
  it('entering range raises the prompt without opening', () => {
    const { trigger, prompts, opens } = makeTrigger();
    const out = trigger.tick({ x: 6, y: 2, z: 31 }); // within radius 3 of (5,2,31)
    expect(out.inRange).toBe(true);
    expect(out.changed).toBe(true);
    expect(trigger.inRange()).toBe(true);
    expect(prompts).toEqual([{ show: true, text: PRODUCT_PANEL_PROMPT_TEXT }]);
    expect(opens).toEqual([]);
  });

  it('out of range never prompts', () => {
    const { trigger, prompts, opens } = makeTrigger();
    const out = trigger.tick({ x: 0, y: 0, z: 0 });
    expect(out.inRange).toBe(false);
    expect(trigger.inRange()).toBe(false);
    expect(prompts).toEqual([]);
    expect(opens).toEqual([]);
  });

  it('onPrompt fires ONLY on range transitions (not every in-range tick)', () => {
    const { trigger, prompts } = makeTrigger();
    trigger.tick({ x: 6, y: 2, z: 31 }); // enter → show
    trigger.tick({ x: 6.5, y: 2, z: 31 }); // still in range → no new prompt
    trigger.tick({ x: 7, y: 2, z: 31 }); // still in range → no new prompt
    expect(prompts).toEqual([{ show: true, text: PRODUCT_PANEL_PROMPT_TEXT }]);
    trigger.tick({ x: 0, y: 0, z: 0 }); // leave → hide
    expect(prompts).toEqual([
      { show: true, text: PRODUCT_PANEL_PROMPT_TEXT },
      { show: false, text: '' },
    ]);
  });

  it('leaving range clears the prompt without ever opening', () => {
    const { trigger, prompts, opens } = makeTrigger();
    trigger.tick({ x: 6, y: 2, z: 31 });
    trigger.tick({ x: 0, y: 0, z: 0 });
    expect(trigger.inRange()).toBe(false);
    expect(prompts[prompts.length - 1]).toEqual({ show: false, text: '' });
    expect(opens).toEqual([]);
  });
});

describe('interact() is the ONLY opening step', () => {
  it('explicit interact while in range opens (calls onOpen) and returns true', () => {
    const { trigger, opens } = makeTrigger();
    trigger.tick({ x: 6, y: 2, z: 31 }); // enter range
    const opened = trigger.interact();
    expect(opened).toBe(true);
    expect(opens).toEqual([true]);
  });

  it('interact when out of range is a safe no-op (returns false, no open)', () => {
    const { trigger, opens } = makeTrigger();
    const opened = trigger.interact(); // never entered range
    expect(opened).toBe(false);
    expect(opens).toEqual([]);
  });

  it('repeated interacts while in range open every time (no debounce — a close button handles dismissal)', () => {
    const { trigger, opens } = makeTrigger();
    trigger.tick({ x: 6, y: 2, z: 31 });
    trigger.interact();
    trigger.interact();
    expect(opens).toEqual([true, true]);
  });
});

describe('reset() and lifecycle', () => {
  it('reset() clears the prompt without opening anything', () => {
    const { trigger, prompts, opens } = makeTrigger();
    trigger.tick({ x: 6, y: 2, z: 31 });
    trigger.reset();
    expect(trigger.inRange()).toBe(false);
    expect(prompts[prompts.length - 1]).toEqual({ show: false, text: '' });
    expect(opens).toEqual([]);
  });

  it('re-enters range after leaving (enter → leave → enter again)', () => {
    const { trigger } = makeTrigger();
    trigger.tick({ x: 6, y: 2, z: 31 });
    trigger.tick({ x: 0, y: 0, z: 0 });
    expect(trigger.inRange()).toBe(false);
    const out = trigger.tick({ x: 6, y: 2, z: 31 });
    expect(out.changed).toBe(true);
    expect(trigger.inRange()).toBe(true);
  });

  it('exposes injected geometry', () => {
    const { trigger } = makeTrigger();
    expect(trigger.panelPos()).toEqual(PANEL_POS);
    expect(trigger.range()).toBe(3);
  });

  it('uses the default range (3) when none is provided', () => {
    const trigger = createProductPanelTrigger({ panelPos: PANEL_POS });
    expect(trigger.range()).toBe(3);
  });
});

describe('never throws on malformed wiring', () => {
  it('tick/interact are safe no-ops with no panelPos', () => {
    const t = createProductPanelTrigger(null);
    expect(() => t.tick(null)).not.toThrow();
    expect(t.tick({ x: 0, y: 0, z: 0 }).inRange).toBe(false);
    expect(t.interact()).toBe(false);
    expect(() => t.reset()).not.toThrow();
  });

  it('a throwing onOpen callback never escapes interact()', () => {
    const trigger = createProductPanelTrigger({
      panelPos: PANEL_POS,
      onOpen: () => { throw new Error('boom'); },
    });
    trigger.tick({ x: 6, y: 2, z: 31 });
    expect(() => trigger.interact()).not.toThrow();
  });

  it('a throwing onPrompt callback never escapes tick()', () => {
    const trigger = createProductPanelTrigger({
      panelPos: PANEL_POS,
      onPrompt: () => { throw new Error('boom'); },
    });
    expect(() => trigger.tick({ x: 6, y: 2, z: 31 })).not.toThrow();
  });
});
