// tests/release-notes.test.js — pure MVP-PROOF RELEASE-NOTES DRAFT assembly + formatting
// (tools/releaseNotes.mjs, v0.2.202). Covers buildReleaseNotesModel (folding an RC-gate verdict
// + an MVP-readiness rollup + a handoff brief into ONE draft model), the curated "what's built"
// sections + advisories, the candidate/readiness summaries, the text/markdown formatters, and
// degraded / missing-input cases. No fs/git — every input is plain data, fully deterministic
// (generatedAt is omitted so the shape is reproducible).
import { describe, it, expect } from 'vitest';
import {
  RELEASE_NOTES_SCHEMA, RELEASE_NOTES_SCHEMA_VERSION, RELEASE_NOTES_BADGE,
  RELEASE_NOTES_WRITE_FILENAME, RELEASE_NOTES_TITLE,
  RELEASE_NOTES_SECTIONS, RELEASE_NOTES_ADVISORIES,
  buildReleaseNotesModel, formatReleaseNotes, formatReleaseNotesMarkdown,
} from '../tools/releaseNotes.mjs';

const V = 'v0.2.202-alpha';

// A representative buildMvpRcGate() verdict (READY by default; override per case).
const rcGate = (over = {}) => ({
  schema: 'torii.mvp-rc-gate', schemaVersion: 1,
  badge: 'MVP RELEASE-CANDIDATE GATE · LOCAL · READ-ONLY',
  gateCommand: 'npm run test:release',
  version: V, gitCommit: 'abc1234',
  status: 'READY', isCandidate: true, pct: 100, reasons: [],
  ...over,
});

// A representative runMvpReadiness() rollup (all-green by default; override per case).
const rollup = (over = {}) => ({
  version: 1, ok: true, mvpPct: 100, status: 'READY', currentVersion: V,
  signals: [{ key: 'version-marker', status: 'ok', detail: `VERSION=${V}` }],
  ...over,
});

// A representative buildHandoffSummary() brief (subset used by the notes).
const handoff = (over = {}) => ({
  schema: 'torii.handoff-summary', version: V, gitCommit: 'abc1234',
  latestReports: ['torii-v0.2.201-mvp-rc-gate-report.md'],
  ...over,
});

describe('release-notes — constants', () => {
  it('exposes a stable schema, version, badge, write filename, and title', () => {
    expect(RELEASE_NOTES_SCHEMA).toBe('torii.release-notes');
    expect(RELEASE_NOTES_SCHEMA_VERSION).toBe(1);
    expect(RELEASE_NOTES_BADGE).toBe('MVP PROOF RELEASE NOTES · DRAFT · LOCAL · READ-ONLY');
    expect(RELEASE_NOTES_WRITE_FILENAME).toBe('RELEASE_NOTES_DRAFT.md');
    expect(RELEASE_NOTES_TITLE).toBe('Torii Quest — MVP Proof-of-Concept');
  });

  it('ships a frozen curated "what\'s built" section list covering the proof surfaces', () => {
    expect(Object.isFrozen(RELEASE_NOTES_SECTIONS)).toBe(true);
    const headings = RELEASE_NOTES_SECTIONS.map((s) => s.heading);
    expect(headings).toContain('Shooter proof loop');
    expect(headings).toContain('Nostr read / profile / leaderboard proof surfaces');
    expect(headings).toContain('Gateway travel shell');
    expect(headings).toContain('Update / VPS readiness');
    expect(headings).toContain('Continuum dashboard');
    expect(headings).toContain('SDK / debug handoff surfaces');
    expect(headings).toContain('Tests / guardrails');
    for (const s of RELEASE_NOTES_SECTIONS) {
      expect(Array.isArray(s.items)).toBe(true);
      expect(s.items.length).toBeGreaterThan(0);
    }
  });

  it('ships a frozen non-blocking advisories list', () => {
    expect(Object.isFrozen(RELEASE_NOTES_ADVISORIES)).toBe(true);
    expect(RELEASE_NOTES_ADVISORIES.join(' ')).toMatch(/rapier/);
  });
});

describe('release-notes — assembly', () => {
  it('folds RC gate + rollup + handoff into a draft model', () => {
    const m = buildReleaseNotesModel({
      rcGate: rcGate(), mvpReadiness: rollup(), handoff: handoff(),
      version: V, gitCommit: 'abc1234', liveUrl: 'https://chiefmonkey.art/quest',
    });
    expect(m.schema).toBe('torii.release-notes');
    expect(m.draft).toBe(true);
    expect(m.version).toBe(V);
    expect(m.gitCommit).toBe('abc1234');
    expect(m.liveUrl).toBe('https://chiefmonkey.art/quest');
    expect(m.candidate).toMatchObject({ present: true, status: 'READY', isCandidate: true, pct: 100 });
    expect(m.readiness).toMatchObject({ present: true, pct: 100, status: 'READY', ok: true });
    expect(m.sections.length).toBe(RELEASE_NOTES_SECTIONS.length);
    expect(m.advisories.length).toBe(RELEASE_NOTES_ADVISORIES.length);
  });

  it('prefers explicit reports, else falls back to the handoff latestReports', () => {
    const explicit = buildReleaseNotesModel({ rcGate: rcGate(), reports: ['a.md', 'b.md'] });
    expect(explicit.latestReports).toEqual(['a.md', 'b.md']);
    const fallback = buildReleaseNotesModel({ rcGate: rcGate(), handoff: handoff() });
    expect(fallback.latestReports).toEqual(['torii-v0.2.201-mvp-rc-gate-report.md']);
  });

  it('resolves version from the rollup/gate/handoff when none is passed', () => {
    const m = buildReleaseNotesModel({ rcGate: rcGate(), mvpReadiness: rollup() });
    expect(m.version).toBe(V);
  });

  it('pins every safety flag false and stays inert', () => {
    const m = buildReleaseNotesModel({ rcGate: rcGate(), mvpReadiness: rollup() });
    expect(m.safety).toEqual({
      released: false, tagged: false, published: false, announced: false,
      served: false, navigated: false, wrote: false, network: false,
    });
    expect(m.rendered).toBe(false);
    expect(m.actionable).toBe(false);
  });

  it('reflects a non-candidate verdict honestly', () => {
    const m = buildReleaseNotesModel({
      rcGate: rcGate({ status: 'BLOCKED', isCandidate: false, pct: 80, reasons: ['release:docs'] }),
      mvpReadiness: rollup({ ok: false, status: 'NEAR', mvpPct: 89 }),
    });
    expect(m.candidate.isCandidate).toBe(false);
    expect(m.candidate.status).toBe('BLOCKED');
    expect(m.candidate.reasons).toContain('release:docs');
    expect(m.readiness.status).toBe('NEAR');
  });
});

describe('release-notes — formatters', () => {
  it('text block carries badge, candidate line, sections, and advisories', () => {
    const m = buildReleaseNotesModel({
      rcGate: rcGate(), mvpReadiness: rollup(), handoff: handoff(),
      version: V, liveUrl: 'https://chiefmonkey.art/quest',
      generatedAt: '2026-06-25T00:00:00Z',
    });
    const txt = formatReleaseNotes(m);
    expect(txt).toContain('MVP PROOF RELEASE NOTES · DRAFT · LOCAL · READ-ONLY');
    expect(txt).toContain('candidate: YES');
    expect(txt).toContain('Shooter proof loop');
    expect(txt).toContain('Known non-blocking advisories');
    expect(txt).toContain('DRAFT ONLY');
    expect(txt).toContain('generated: 2026-06-25T00:00:00Z');
  });

  it('markdown carries the title, candidate, sections, advisories, and draft-only note', () => {
    const m = buildReleaseNotesModel({ rcGate: rcGate(), mvpReadiness: rollup(), version: V });
    const md = formatReleaseNotesMarkdown(m);
    expect(md).toContain('# Torii Quest — MVP Proof-of-Concept — Release Notes (DRAFT)');
    expect(md).toContain('**Release candidate:** YES');
    expect(md).toContain('### Shooter proof loop');
    expect(md).toContain('## Known non-blocking advisories');
    expect(md).toContain('_DRAFT ONLY');
  });

  it('both formatters are null-safe', () => {
    expect(formatReleaseNotes(null)).toBe('release-notes: (no draft)');
    expect(formatReleaseNotesMarkdown(null)).toContain('_(no draft)_');
  });
});

describe('release-notes — robustness', () => {
  it('degrades to honest UNKNOWNs with no inputs and never throws', () => {
    expect(() => buildReleaseNotesModel({})).not.toThrow();
    const m = buildReleaseNotesModel({});
    expect(m.candidate.present).toBe(false);
    expect(m.candidate.status).toBe('UNKNOWN');
    expect(m.readiness.present).toBe(false);
    expect(m.version).toBe(null);
    // the curated narrative is always present even with no live signals
    expect(m.sections.length).toBe(RELEASE_NOTES_SECTIONS.length);
  });

  it('never throws on garbled inputs', () => {
    expect(() => buildReleaseNotesModel({ rcGate: 42, mvpReadiness: 'nope', handoff: [] })).not.toThrow();
    const m = buildReleaseNotesModel({ rcGate: 42, mvpReadiness: 'nope', handoff: [] });
    expect(m.candidate.present).toBe(false);
    expect(m.readiness.present).toBe(false);
  });
});
