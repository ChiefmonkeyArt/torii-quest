// tests/update-check.test.js — torii.quest GitHub update-check helpers
// (updateCheck.js, LEAN-5, v0.2.138). Asserts the semver compare, release
// parsing, update evaluation, and the INERT view-model are deterministic and
// carry NO network/auto-update/clickable surface.
import { describe, it, expect } from 'vitest';
import {
  compareVersions, parseRelease, evaluateUpdate, updateCheckView,
  UPDATE_STATUS, RELEASE_SOURCE,
} from '../src/engine/update/updateCheck.js';
import { VERSION } from '../src/config.js';

describe('updateCheck — RELEASE_SOURCE', () => {
  // v0.2.361-alpha (UPD-1): the release-source constant was corrected from the
  // legacy `torii-gate` name to the current `torii-quest` repo. Before this
  // fix the LIVE update check always resolved to UNABLE (the wrong repo 404s)
  // even when the API was reachable.
  it('points at the real repo ChiefmonkeyArt/torii-quest (post-rename)', () => {
    expect(RELEASE_SOURCE.owner).toBe('ChiefmonkeyArt');
    expect(RELEASE_SOURCE.repo).toBe('torii-quest');
    expect(RELEASE_SOURCE.latestReleaseUrl).toBe(
      'https://api.github.com/repos/ChiefmonkeyArt/torii-quest/releases/latest');
    expect(RELEASE_SOURCE.releasesPageUrl).toBe(
      'https://github.com/ChiefmonkeyArt/torii-quest/releases');
    // The legacy placeholder must not resurface.
    expect(RELEASE_SOURCE.repo).not.toBe('torii-gate');
  });
});

describe('updateCheck — compareVersions', () => {
  it('orders numeric cores', () => {
    expect(compareVersions('0.2.137', '0.2.138')).toBe(-1);
    expect(compareVersions('0.2.138', '0.2.137')).toBe(1);
    expect(compareVersions('0.3.0', '0.2.999')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  });

  it('treats equal versions as 0 regardless of leading v', () => {
    expect(compareVersions('v0.2.138', '0.2.138')).toBe(0);
    expect(compareVersions('0.2.138-alpha', 'v0.2.138-alpha')).toBe(0);
  });

  it('ranks a prerelease below the same full release (semver rule)', () => {
    expect(compareVersions('0.2.138-alpha', '0.2.138')).toBe(-1);
    expect(compareVersions('0.2.138', '0.2.138-alpha')).toBe(1);
  });

  it('compares prerelease identifiers', () => {
    expect(compareVersions('0.2.138-alpha', '0.2.138-beta')).toBe(-1);
    expect(compareVersions('0.2.138-alpha.1', '0.2.138-alpha.2')).toBe(-1);
  });
});

describe('updateCheck — parseRelease', () => {
  it('normalises a GitHub-release-shaped object', () => {
    const r = parseRelease({
      tag_name: 'v0.2.139-alpha',
      name: 'Torii Quest v0.2.139-alpha',
      html_url: 'https://github.com/torii-quest/torii-quest/releases/tag/v0.2.139-alpha',
      body: 'notes',
      draft: false,
      prerelease: true,
      published_at: '2026-06-24T00:00:00Z',
    });
    expect(r.ok).toBe(true);
    expect(r.tag).toBe('v0.2.139-alpha');
    expect(r.version).toBe('0.2.139-alpha');
    expect(r.url).toContain('github.com');
    expect(r.errors).toEqual([]);
  });

  it('flags a missing tag and bad input without throwing', () => {
    expect(parseRelease({}).ok).toBe(false);
    expect(parseRelease(null).ok).toBe(false);
    expect(parseRelease(undefined).errors.length).toBeGreaterThan(0);
  });
});

describe('updateCheck — evaluateUpdate', () => {
  it('reports update-available when the release is newer than runtime', () => {
    const e = evaluateUpdate({ tag_name: 'v0.2.999-alpha' }, 'v0.2.138-alpha');
    expect(e.status).toBe(UPDATE_STATUS.UPDATE_AVAILABLE);
    expect(e.updateAvailable).toBe(true);
    expect(e.latestVersion).toBe('0.2.999-alpha');
  });

  it('reports up-to-date when runtime matches or exceeds the release', () => {
    const e = evaluateUpdate({ tag_name: 'v0.2.138-alpha' }, 'v0.2.138-alpha');
    expect(e.status).toBe(UPDATE_STATUS.UP_TO_DATE);
    expect(e.updateAvailable).toBe(false);
  });

  it('reports unknown for a draft or unparseable release', () => {
    expect(evaluateUpdate({ tag_name: 'v9.9.9', draft: true }).status).toBe(UPDATE_STATUS.UNKNOWN);
    expect(evaluateUpdate({}).status).toBe(UPDATE_STATUS.UNKNOWN);
  });

  it('defaults currentVersion to the runtime VERSION', () => {
    const e = evaluateUpdate({ tag_name: VERSION });
    expect(e.currentVersion).toBe(VERSION);
    expect(e.status).toBe(UPDATE_STATUS.UP_TO_DATE);
  });
});

describe('updateCheck — updateCheckView (inert)', () => {
  it('builds a render-ready view-model with no actionable surface', () => {
    const v = updateCheckView({ tag_name: 'v0.2.999-alpha', body: 'big release notes here' }, {
      currentVersion: 'v0.2.138-alpha',
    });
    expect(v.status).toBe(UPDATE_STATUS.UPDATE_AVAILABLE);
    expect(v.updateAvailable).toBe(true);
    expect(v.prompt).toContain('0.2.999-alpha');
    expect(v.actionable).toBe(false); // never clickable / auto-update
    expect(v.releasesPageUrl).toBe(RELEASE_SOURCE.releasesPageUrl);
  });

  it('caps the notes preview to a single capped line', () => {
    const long = 'x'.repeat(500).replace(/x/g, 'word ');
    const v = updateCheckView({ tag_name: 'v0.2.999-alpha', body: long }, { notesMax: 40 });
    expect(v.notesPreview.length).toBeLessThanOrEqual(40);
    expect(v.notesPreview).not.toContain('\n');
  });

  it('exposes no fetch/update/navigate action keys', () => {
    const v = updateCheckView({ tag_name: 'v0.2.138-alpha' });
    expect(v).not.toHaveProperty('fetch');
    expect(v).not.toHaveProperty('update');
    expect(v).not.toHaveProperty('navigate');
    expect(v).not.toHaveProperty('install');
  });
});
