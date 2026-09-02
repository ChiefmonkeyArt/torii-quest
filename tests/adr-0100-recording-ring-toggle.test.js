// ADR-0100 (v0.2.744-alpha) — Recording-ring gate for the 1Hz auto-capture ring.
//
// The recording ring runs continuously by default (ADR-0055) while the owner
// plays. This gate lets the owner PAUSE the ring from the Kami-mode dev menu
// (or the console mirror ToriiDebug.recording.enabled(...)). Locks:
//
//   1. Default is ON (never break the ADR-0055 default without an explicit
//      user action).
//   2. setRecordingRingEnabled(false) short-circuits BEFORE the auto-capture
//      state machine's tick emits a request — the arenaRuntime driver returns
//      early. We assert that lock by reading the runtime source (mirrors the
//      pause-input.test.js locking pattern for the Kami import line).
//   3. The recIndicator's isActive predicate also observes the gate so the
//      on-screen recording dot goes dark when the ring is off.
//   4. The dev-menu row registration uses the recording-ring gate's live
//      accessors as get + set — single source of truth with the console
//      mirror in main.js.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  isRecordingRingEnabled,
  setRecordingRingEnabled,
  __resetRecordingRingGateForTests,
} from '../src/engine/dev/recordingRingGate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = readFileSync(resolve(HERE, '../src/arenaRuntime.js'), 'utf8');
const MAIN    = readFileSync(resolve(HERE, '../src/main.js'), 'utf8');

describe('ADR-0100 recording-ring gate — pure module', () => {
  beforeEach(() => __resetRecordingRingGateForTests());

  it('defaults to ON so the ADR-0055 behaviour is unchanged for anyone who never touches the menu', () => {
    expect(isRecordingRingEnabled()).toBe(true);
  });

  it('setRecordingRingEnabled(false) flips OFF; (true) flips back ON', () => {
    setRecordingRingEnabled(false);
    expect(isRecordingRingEnabled()).toBe(false);
    setRecordingRingEnabled(true);
    expect(isRecordingRingEnabled()).toBe(true);
  });

  it('setter coerces truthy/falsy values to a boolean', () => {
    setRecordingRingEnabled(1);
    expect(isRecordingRingEnabled()).toBe(true);
    setRecordingRingEnabled(0);
    expect(isRecordingRingEnabled()).toBe(false);
    setRecordingRingEnabled('yes');
    expect(isRecordingRingEnabled()).toBe(true);
    setRecordingRingEnabled('');
    expect(isRecordingRingEnabled()).toBe(false);
  });

  it('setter returns the new value for chaining', () => {
    expect(setRecordingRingEnabled(false)).toBe(false);
    expect(setRecordingRingEnabled(true)).toBe(true);
  });

  it('reset helper restores the default', () => {
    setRecordingRingEnabled(false);
    __resetRecordingRingGateForTests();
    expect(isRecordingRingEnabled()).toBe(true);
  });
});

describe('ADR-0100 recording-ring gate — arenaRuntime wiring locks', () => {
  it('imports the recording-ring gate from the pure module', () => {
    // Locks the exact import line (mirrors the ADR-0099 pattern for Kami
    // imports). If this test fails, a refactor moved the module — update the
    // line here.
    expect(RUNTIME).toMatch(
      /import \{ isRecordingRingEnabled, setRecordingRingEnabled \} from '\.\/engine\/dev\/recordingRingGate\.js';/
    );
  });

  it('gates _driveAutoCapture with an early return before _autoCap.tick()', () => {
    // The runtime MUST refuse the capture request BEFORE the auto-capture
    // state machine emits a request — otherwise a paused ring would still
    // pay the snapshot + frame-grab cost.
    expect(RUNTIME).toMatch(/if \(!isRecordingRingEnabled\(\)\) return;/);
  });

  it('recIndicator isActive predicate observes the gate', () => {
    // The on-screen dot must go dark when the ring is off. Lock the exact
    // conjunction shape (isPlaying() AND isRecordingRingEnabled()).
    expect(RUNTIME).toMatch(/isPlaying\(\) && isRecordingRingEnabled\(\)/);
  });

  it('registers the dev-menu row against the SAME accessors (single source of truth)', () => {
    // The registered toggle's get + set delegate to the pure module. If a
    // future refactor introduced a duplicate flag, this lock catches it.
    expect(RUNTIME).toMatch(/id: 'recording-ring'/);
    expect(RUNTIME).toMatch(/get: \(\) => isRecordingRingEnabled\(\)/);
    expect(RUNTIME).toMatch(/set: \(on\) => \{ setRecordingRingEnabled\(on\); \}/);
  });
});

describe('ADR-0100 ToriiDebug.recording console mirror in main.js', () => {
  it('imports the same recording-ring gate', () => {
    expect(MAIN).toMatch(
      /import\(['"]\.\/engine\/dev\/recordingRingGate\.js['"]\)\.then\(\(\{ isRecordingRingEnabled, setRecordingRingEnabled \}\) =>/
    );
  });

  it('exposes state() and enabled() on ToriiDebug.recording', () => {
    // Console parity for the muscle-memory path. Both flip the SAME flag as
    // the dev-menu row above.
    expect(MAIN).toMatch(/window\.ToriiDebug\.recording = \{/);
    expect(MAIN).toMatch(/state: \(\) => \(\{ enabled: isRecordingRingEnabled\(\) \}\)/);
    expect(MAIN).toMatch(/enabled: \(on\) => setRecordingRingEnabled\(on\)/);
  });
});
