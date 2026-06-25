// tests/vps-dry-run.test.js — pure VPS install dry-run checklist logic (tools/vpsDryRun.mjs,
// v0.2.193). Covers each individual check (pass/fail/warn/skip), the folded runVpsDryRun
// result + summary, the safety-floor reuse, and the text formatter on degraded input. No
// fs/network — every input is plain data, fully node-deterministic.
import { describe, it, expect } from 'vitest';
import {
  VPS_DRY_RUN_BADGE, REQUIRED_DOCS, REQUIRED_VPS_SECTIONS, REQUIRED_BUILD_COMMANDS,
  REAL_REPO_SLUG, LIVE_URLS,
  checkDistBundle, checkReleaseMetaPresent, checkReleaseMetaManualOnly, checkRealRepoMetadata,
  checkZoneFallbackDocs, checkVpsSections, checkBuildCommands, checkRollbackSafety,
  checkServiceWorkerCaveat, checkLiveUrls, runVpsDryRun, formatVpsDryRun,
} from '../tools/vpsDryRun.mjs';
import { buildReleaseMeta } from '../tools/releaseMeta.mjs';

const META = buildReleaseMeta({ version: 'v0.2.193-alpha' });

// A doc corpus that satisfies every content check.
const GOOD_VPS = `
## 5. Get the code, build, place the bundle
npm run build
npm run check
## 7. Manual update from GitHub
no auto-update here; deploy by hand
## 8. Rollback
re-point the symlink at the previous release
## 9. Security notes
The app ships a service worker (sw.js); bump its CACHE_VERSION to cache-bust when precached assets change.
try_files {path} /index.html for /zone/ paths
`;
const GOOD_UPDATE = `metadata points at ${REAL_REPO_SLUG}`;
const GOOD_HANDOFF = `
Live: https://torii-quest.pplx.app self-hosted at torii.quest
try_files $uri /index.html for /zone/ deep links
`;

function goodDocs() {
  return {
    'VPS_INSTALL.md': GOOD_VPS,
    'UPDATE_CHECK.md': GOOD_UPDATE,
    'HANDOFF.md': GOOD_HANDOFF,
  };
}

describe('constants', () => {
  it('exports the badge, required docs/sections/commands, repo slug, urls', () => {
    expect(VPS_DRY_RUN_BADGE).toMatch(/READ-ONLY/);
    expect(REQUIRED_DOCS).toContain('VPS_INSTALL.md');
    expect(REQUIRED_VPS_SECTIONS).toEqual(expect.arrayContaining(['rollback', 'security']));
    expect(REQUIRED_BUILD_COMMANDS).toContain('npm run build');
    expect(REAL_REPO_SLUG).toBe('ChiefmonkeyArt/torii-gate');
    expect(LIVE_URLS).toEqual(expect.arrayContaining(['torii.quest', 'torii-quest.pplx.app']));
  });
});

describe('checkDistBundle', () => {
  it('skips when there is no build', () => {
    expect(checkDistBundle(undefined).status).toBe('skip');
    expect(checkDistBundle({}).status).toBe('skip');
  });
  it('passes when index.html + release-metadata.json present', () => {
    const r = checkDistBundle({ paths: ['index.html', 'release-metadata.json', 'assets/x.js'] });
    expect(r.status).toBe('pass');
  });
  it('warns when index.html present but metadata not copied', () => {
    expect(checkDistBundle({ paths: ['index.html'] }).status).toBe('warn');
  });
  it('fails when a built bundle lacks index.html', () => {
    expect(checkDistBundle({ paths: ['assets/x.js'] }).status).toBe('fail');
  });
  it('normalizes leading ./ and backslashes', () => {
    const r = checkDistBundle({ paths: ['./index.html', 'release-metadata.json'] });
    expect(r.status).toBe('pass');
  });
});

describe('checkReleaseMetaPresent', () => {
  it('passes for a real metadata object', () => {
    expect(checkReleaseMetaPresent(META).status).toBe('pass');
  });
  it('fails on null / array / non-object', () => {
    expect(checkReleaseMetaPresent(null).status).toBe('fail');
    expect(checkReleaseMetaPresent([]).status).toBe('fail');
    expect(checkReleaseMetaPresent('x').status).toBe('fail');
  });
});

describe('checkReleaseMetaManualOnly', () => {
  it('passes when manual=true, autoUpdate/actionable=false and metadata is valid', () => {
    expect(checkReleaseMetaManualOnly(META).status).toBe('pass');
  });
  it('fails when autoUpdate is flipped', () => {
    const bad = { ...META, update: { ...META.update, autoUpdate: true } };
    expect(checkReleaseMetaManualOnly(bad).status).toBe('fail');
  });
  it('fails when actionable is flipped', () => {
    const bad = { ...META, update: { ...META.update, actionable: true } };
    expect(checkReleaseMetaManualOnly(bad).status).toBe('fail');
  });
  it('fails when manual is not true', () => {
    const bad = { ...META, update: { ...META.update, manual: false } };
    expect(checkReleaseMetaManualOnly(bad).status).toBe('fail');
  });
  it('warns when manual-only holds but other validation fails', () => {
    const odd = { ...META, version: 'not-a-version' };
    expect(checkReleaseMetaManualOnly(odd).status).toBe('warn');
  });
  it('fails on null', () => {
    expect(checkReleaseMetaManualOnly(null).status).toBe('fail');
  });
});

describe('checkRealRepoMetadata', () => {
  it('passes when metadata + doc reference the real repo', () => {
    expect(checkRealRepoMetadata(META, GOOD_UPDATE).status).toBe('pass');
  });
  it('warns when metadata is right but the doc omits it', () => {
    expect(checkRealRepoMetadata(META, 'nothing here').status).toBe('warn');
  });
  it('fails when metadata points at the placeholder', () => {
    const placeholder = buildReleaseMeta({ version: 'v0.2.193-alpha', owner: 'torii-quest', repo: 'torii-quest' });
    expect(checkRealRepoMetadata(placeholder, GOOD_UPDATE).status).toBe('fail');
  });
  it('fails when metadata source is missing', () => {
    expect(checkRealRepoMetadata({}, GOOD_UPDATE).status).toBe('fail');
  });
});

describe('checkZoneFallbackDocs', () => {
  it('passes when VPS + HANDOFF show the index.html fallback and the /zone/ route', () => {
    expect(checkZoneFallbackDocs(GOOD_VPS, GOOD_HANDOFF).status).toBe('pass');
  });
  it('fails when VPS has no index.html fallback', () => {
    expect(checkZoneFallbackDocs('no fallback here', GOOD_HANDOFF).status).toBe('fail');
  });
  it('warns when the fallback is shown but the /zone/ link is thin', () => {
    const vpsNoZone = 'try_files {path} /index.html';
    expect(checkZoneFallbackDocs(vpsNoZone, 'plain').status).toBe('warn');
  });
});

describe('checkVpsSections', () => {
  it('passes when all required sections present', () => {
    expect(checkVpsSections(GOOD_VPS).status).toBe('pass');
  });
  it('fails when a section is missing', () => {
    const noRollback = GOOD_VPS.replace(/rollback/gi, 'xxx');
    expect(checkVpsSections(noRollback).status).toBe('fail');
  });
  it('fails on empty/missing doc', () => {
    expect(checkVpsSections('').status).toBe('fail');
    expect(checkVpsSections(undefined).status).toBe('fail');
  });
});

describe('checkBuildCommands', () => {
  it('passes when both commands are documented across the corpus', () => {
    expect(checkBuildCommands(GOOD_VPS, '').status).toBe('pass');
  });
  it('finds commands split across VPS + HANDOFF', () => {
    expect(checkBuildCommands('npm run build', 'npm run check').status).toBe('pass');
  });
  it('fails when a command is undocumented', () => {
    expect(checkBuildCommands('npm run build only', '').status).toBe('fail');
  });
});

describe('checkRollbackSafety', () => {
  it('passes with rollback+symlink+manual wording', () => {
    expect(checkRollbackSafety(GOOD_VPS).status).toBe('pass');
  });
  it('fails without the symlink rollback model', () => {
    expect(checkRollbackSafety('no rollbk').status).toBe('fail');
    expect(checkRollbackSafety('rollback by hand but no link word').status).toBe('fail');
  });
  it('warns when rollback present but manual wording thin', () => {
    const r = checkRollbackSafety('Rollback: re-point the symlink at a release');
    expect(r.status).toBe('warn');
  });
});

describe('checkServiceWorkerCaveat', () => {
  it('passes when the service worker AND cache-busting are documented', () => {
    expect(checkServiceWorkerCaveat(GOOD_VPS).status).toBe('pass');
    expect(checkServiceWorkerCaveat('ships a service worker (sw.js); bump CACHE_VERSION to cache-bust').status).toBe('pass');
  });
  it('fails when no service-worker mention exists', () => {
    expect(checkServiceWorkerCaveat('nothing about caching').status).toBe('fail');
  });
  it('fails when the service worker is mentioned but cache-busting is not', () => {
    expect(checkServiceWorkerCaveat('we ship a service worker').status).toBe('fail');
  });
});

describe('checkLiveUrls', () => {
  it('passes when both URLs referenced', () => {
    expect(checkLiveUrls(GOOD_HANDOFF).status).toBe('pass');
  });
  it('warns when only one URL referenced', () => {
    expect(checkLiveUrls('only torii.quest here').status).toBe('warn');
  });
  it('fails when neither URL referenced', () => {
    expect(checkLiveUrls('no urls').status).toBe('fail');
  });
});

describe('runVpsDryRun', () => {
  it('is all-green for a complete repo (dist skipped)', () => {
    const r = runVpsDryRun({ docs: goodDocs(), releaseMeta: META });
    expect(r.ok).toBe(true);
    expect(r.summary.fail).toBe(0);
    expect(r.badge).toBe(VPS_DRY_RUN_BADGE);
    // 11 checks: required-docs + 10 content/dist rows
    expect(r.summary.total).toBe(11);
    expect(r.checks.find((c) => c.id === 'dist-bundle').status).toBe('skip');
  });

  it('passes the dist row when a built bundle is supplied', () => {
    const r = runVpsDryRun({
      docs: goodDocs(), releaseMeta: META,
      dist: { paths: ['index.html', 'release-metadata.json'] },
    });
    expect(r.checks.find((c) => c.id === 'dist-bundle').status).toBe('pass');
    expect(r.ok).toBe(true);
  });

  it('fails when required docs are missing', () => {
    const r = runVpsDryRun({ docs: {}, releaseMeta: META });
    expect(r.ok).toBe(false);
    expect(r.summary.fail).toBeGreaterThan(0);
    expect(r.errors.join(' ')).toMatch(/required deploy docs/);
  });

  it('fails when metadata is missing', () => {
    const r = runVpsDryRun({ docs: goodDocs(), releaseMeta: null });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'release-meta-present').status).toBe('fail');
  });

  it('fails when metadata auto-update contract is violated', () => {
    const bad = { ...META, update: { ...META.update, autoUpdate: true } };
    const r = runVpsDryRun({ docs: goodDocs(), releaseMeta: bad });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'release-meta-manual-only').status).toBe('fail');
  });

  it('is safe on no-arg / degraded input', () => {
    const r = runVpsDryRun();
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.checks)).toBe(true);
    expect(() => runVpsDryRun(null)).not.toThrow();
  });
});

describe('formatVpsDryRun', () => {
  it('renders a block with the badge and summary line', () => {
    const out = formatVpsDryRun(runVpsDryRun({ docs: goodDocs(), releaseMeta: META }));
    expect(out).toMatch(/VPS install dry-run/);
    expect(out).toMatch(/summary:/);
    expect(out).toMatch(/READY/);
  });
  it('is safe on null / malformed', () => {
    expect(formatVpsDryRun(null)).toMatch(/no result/);
    expect(formatVpsDryRun({})).toMatch(/no result/);
  });
});
