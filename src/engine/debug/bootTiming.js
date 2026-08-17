// bootTiming.js — lightweight boot-phase timing instrumentation (v0.2.529).
// Zero dependencies (no THREE). Safe to import from both the shell (main.js)
// and the arena runtime. Uses performance.mark/measure + a plain object so
// timings survive across the dynamic-import boundary.
//
// Usage:
//   mark('enter-click')            // record a point in time
//   startPhase('import-runtime')   // start a duration
//   endPhase('import-runtime')     // end a duration
//   getTimings()                    // → { marks: {...}, phases: {...} }
//   logReport()                     // console.table the phases

const _marks = {};
const _phases = {};   // name → { start, end, duration }

export function mark(name) {
  _marks[name] = performance.now();
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(`torii:${name}`);
  }
}

export function startPhase(name) {
  if (!_phases[name]) _phases[name] = {};
  _phases[name].start = performance.now();
}

export function endPhase(name) {
  if (!_phases[name]) _phases[name] = {};
  _phases[name].end = performance.now();
  if (_phases[name].start != null) {
    _phases[name].duration = _phases[name].end - _phases[name].start;
  }
}

export function getTimings() {
  return {
    marks: { ..._marks },
    phases: Object.fromEntries(
      Object.entries(_phases).map(([k, v]) => [k, { ...v }])
    ),
  };
}

export function logReport() {
  const t = getTimings();
  console.log('[torii:boot-timing] marks:', t.marks);
  console.table(t.phases);
  return t;
}

// Reset — call at the start of a fresh boot attempt so stale timings don't leak.
export function resetTimings() {
  for (const k of Object.keys(_marks)) delete _marks[k];
  for (const k of Object.keys(_phases)) delete _phases[k];
}
