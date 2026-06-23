// tests/events.test.js — locks down the event bus (src/events.js): on/emit/off,
// no-subscriber no-op, multi-subscriber fan-out, ordering, and payload passing.
// Tests use unique synthetic event names so they never collide with the live
// `EV` registry or leak listeners between cases (the bus has no reset API by
// design — adding one would be app surface we don't want to expose).
import { describe, it, expect } from 'vitest';
import { on, off, emit, EV } from '../src/events.js';

let _n = 0;
const uniqueEv = () => `test:ev:${_n++}`;

describe('event bus', () => {
  it('emit with no subscribers is a no-op (does not throw)', () => {
    expect(() => emit(uniqueEv(), { any: 'data' })).not.toThrow();
  });

  it('on + emit delivers the payload to the subscriber', () => {
    const ev = uniqueEv();
    let received = null;
    on(ev, (d) => { received = d; });
    emit(ev, { hp: 7 });
    expect(received).toEqual({ hp: 7 });
  });

  it('fans out to every subscriber in registration order', () => {
    const ev = uniqueEv();
    const calls = [];
    on(ev, () => calls.push('a'));
    on(ev, () => calls.push('b'));
    on(ev, () => calls.push('c'));
    emit(ev);
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('off removes only the named handler', () => {
    const ev = uniqueEv();
    const calls = [];
    const a = () => calls.push('a');
    const b = () => calls.push('b');
    on(ev, a);
    on(ev, b);
    off(ev, a);
    emit(ev);
    expect(calls).toEqual(['b']);
  });

  it('off on an unknown event/handler is a safe no-op', () => {
    expect(() => off(uniqueEv(), () => {})).not.toThrow();
  });

  it('the same handler subscribed twice fires twice', () => {
    const ev = uniqueEv();
    let count = 0;
    const fn = () => { count++; };
    on(ev, fn);
    on(ev, fn);
    emit(ev);
    expect(count).toBe(2);
  });

  it('EV registry exposes the canonical, frozen event names', () => {
    expect(EV.PHASE_CHANGE).toBe('game:phase');
    expect(EV.BOT_HIT_BY_PLAYER).toBe('bot:hitByPlayer');
    expect(Object.isFrozen(EV)).toBe(true);
  });
});
