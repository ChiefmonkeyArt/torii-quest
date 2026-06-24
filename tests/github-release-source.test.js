// tests/github-release-source.test.js — torii.quest GitHub Releases source adapter
// (githubReleaseSource.js, LEAN-5, v0.2.157). Asserts the pure normaliser/selector
// turns a GitHub `releases/latest` object, a `releases` array, or a manifest into
// the release shape evaluateUpdate() accepts; degrades draft/prerelease/malformed
// payloads to safe EMPTY/UNKNOWN states without throwing; and that the optional
// fetch helper is host-only (refuses without an injected fetcher, never auto-fires).
import { describe, it, expect } from 'vitest';
import {
  normalizeRelease, selectLatestRelease, evaluateFromSource, fetchLatestRelease,
  SOURCE_KIND, SOURCE_STATUS, UPDATE_STATUS, RELEASE_SOURCE,
} from '../src/engine/update/githubReleaseSource.js';
import { VERSION } from '../src/config.js';
import * as SDK from '../src/sdk/index.js';

const GH_RELEASE = Object.freeze({
  tag_name: 'v0.2.999-alpha',
  name: 'Torii Quest v0.2.999-alpha',
  html_url: 'https://github.com/torii-quest/torii-quest/releases/tag/v0.2.999-alpha',
  body: 'Bigger arena.',
  draft: false,
  prerelease: false,
  published_at: '2026-06-24T00:00:00Z',
});

describe('normalizeRelease', () => {
  it('maps a GitHub release object into the parseRelease shape', () => {
    const r = normalizeRelease(GH_RELEASE);
    expect(r.tag_name).toBe('v0.2.999-alpha');
    expect(r.html_url).toContain('github.com');
    expect(r.draft).toBe(false);
    expect(r.prerelease).toBe(false);
  });

  it('maps a simple manifest (version/url/notes) into the release shape', () => {
    const r = normalizeRelease({ version: 'v0.3.0-alpha', url: 'https://torii.quest/r', notes: 'hi' });
    expect(r.tag_name).toBe('v0.3.0-alpha');
    expect(r.html_url).toBe('https://torii.quest/r');
    expect(r.body).toBe('hi');
    expect(r.name).toBe('v0.3.0-alpha');
  });

  it('falls back to the releases page url when none is given', () => {
    expect(normalizeRelease({ tag_name: 'v1.0.0' }).html_url).toBe(RELEASE_SOURCE.releasesPageUrl);
  });

  it('returns null for non-objects or objects with no version identifier', () => {
    expect(normalizeRelease(null)).toBeNull();
    expect(normalizeRelease('v1')).toBeNull();
    expect(normalizeRelease([])).toBeNull();
    expect(normalizeRelease({ name: 'no tag here' })).toBeNull();
  });

  it('coerces draft/prerelease to strict booleans', () => {
    const r = normalizeRelease({ tag_name: 'v1', draft: 'yes', prerelease: 1 });
    expect(r.draft).toBe(false);
    expect(r.prerelease).toBe(false);
  });
});

describe('selectLatestRelease — single object', () => {
  it('selects a normal release (LATEST/OK)', () => {
    const s = selectLatestRelease(GH_RELEASE);
    expect(s.status).toBe(SOURCE_STATUS.OK);
    expect(s.kind).toBe(SOURCE_KIND.LATEST);
    expect(s.release.tag_name).toBe('v0.2.999-alpha');
    expect(s.candidates).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it('filters a draft to EMPTY (no release returned)', () => {
    const s = selectLatestRelease({ ...GH_RELEASE, draft: true });
    expect(s.status).toBe(SOURCE_STATUS.EMPTY);
    expect(s.release).toBeNull();
    expect(s.errors[0]).toMatch(/draft/);
  });

  it('keeps a prerelease by default (alpha project) but filters it when asked', () => {
    const pre = { ...GH_RELEASE, prerelease: true };
    expect(selectLatestRelease(pre).status).toBe(SOURCE_STATUS.OK);
    const filtered = selectLatestRelease(pre, { includePrerelease: false });
    expect(filtered.status).toBe(SOURCE_STATUS.EMPTY);
    expect(filtered.errors[0]).toMatch(/prerelease/);
  });

  it('reports EMPTY for an object with no version identifier', () => {
    const s = selectLatestRelease({ name: 'nope' });
    expect(s.status).toBe(SOURCE_STATUS.EMPTY);
    expect(s.kind).toBe(SOURCE_KIND.LATEST);
  });
});

describe('selectLatestRelease — array (releases list)', () => {
  it('picks the highest-version eligible release', () => {
    const list = [
      { tag_name: 'v0.2.100-alpha' },
      { tag_name: 'v0.2.300-alpha' },
      { tag_name: 'v0.2.200-alpha' },
    ];
    const s = selectLatestRelease(list);
    expect(s.kind).toBe(SOURCE_KIND.LIST);
    expect(s.status).toBe(SOURCE_STATUS.OK);
    expect(s.release.tag_name).toBe('v0.2.300-alpha');
    expect(s.candidates).toBe(3);
  });

  it('skips drafts/prereleases when selecting the latest', () => {
    const list = [
      { tag_name: 'v0.2.500-alpha', draft: true },
      { tag_name: 'v0.2.400-alpha', prerelease: true },
      { tag_name: 'v0.2.300-alpha' },
    ];
    const s = selectLatestRelease(list, { includePrerelease: false });
    expect(s.release.tag_name).toBe('v0.2.300-alpha');
  });

  it('returns EMPTY for [] and for all-ineligible lists', () => {
    expect(selectLatestRelease([]).status).toBe(SOURCE_STATUS.EMPTY);
    const allDraft = selectLatestRelease([{ tag_name: 'v1', draft: true }]);
    expect(allDraft.status).toBe(SOURCE_STATUS.EMPTY);
    expect(allDraft.release).toBeNull();
  });
});

describe('selectLatestRelease — malformed', () => {
  it('reports MALFORMED for non-object/non-array payloads without throwing', () => {
    for (const bad of [null, undefined, 'str', 42, true]) {
      const s = selectLatestRelease(bad);
      expect(s.status).toBe(SOURCE_STATUS.MALFORMED);
      expect(s.kind).toBe(SOURCE_KIND.UNKNOWN);
      expect(s.release).toBeNull();
    }
  });
});

describe('evaluateFromSource', () => {
  it('reports update-available for a newer release', () => {
    const e = evaluateFromSource(GH_RELEASE, { currentVersion: 'v0.2.138-alpha' });
    expect(e.source.status).toBe(SOURCE_STATUS.OK);
    expect(e.status).toBe(UPDATE_STATUS.UPDATE_AVAILABLE);
    expect(e.updateAvailable).toBe(true);
    expect(e.latestVersion).toBe('0.2.999-alpha');
  });

  it('reports up-to-date when the runtime equals the latest release', () => {
    const e = evaluateFromSource({ tag_name: 'v0.2.138-alpha' }, { currentVersion: 'v0.2.138-alpha' });
    expect(e.status).toBe(UPDATE_STATUS.UP_TO_DATE);
    expect(e.updateAvailable).toBe(false);
  });

  it('reports up-to-date when the runtime is newer than an older release', () => {
    const e = evaluateFromSource({ tag_name: 'v0.2.100-alpha' }, { currentVersion: 'v0.2.200-alpha' });
    expect(e.status).toBe(UPDATE_STATUS.UP_TO_DATE);
    expect(e.updateAvailable).toBe(false);
  });

  it('degrades draft/empty/malformed payloads to UNKNOWN without throwing', () => {
    expect(evaluateFromSource({ tag_name: 'v9.9.9', draft: true }).status).toBe(UPDATE_STATUS.UNKNOWN);
    expect(evaluateFromSource([]).status).toBe(UPDATE_STATUS.UNKNOWN);
    const bad = evaluateFromSource(null);
    expect(bad.status).toBe(UPDATE_STATUS.UNKNOWN);
    expect(bad.updateAvailable).toBe(false);
    expect(bad.latestVersion).toBeNull();
    expect(bad.source.status).toBe(SOURCE_STATUS.MALFORMED);
  });

  it('defaults currentVersion to the runtime VERSION', () => {
    const e = evaluateFromSource({ tag_name: VERSION });
    expect(e.currentVersion).toBe(VERSION);
    expect(e.status).toBe(UPDATE_STATUS.UP_TO_DATE);
  });
});

describe('fetchLatestRelease — host-only, injected fetcher', () => {
  it('refuses (no throw, no wire) when no fetcher is injected', async () => {
    const r = await fetchLatestRelease({});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(SOURCE_STATUS.MALFORMED);
    expect(r.payload).toBeNull();
    expect(r.errors[0]).toMatch(/no fetcher/);
  });

  it('uses the injected fetcher and evaluates the JSON response', async () => {
    const fetcher = async () => ({ ok: true, status: 200, json: async () => GH_RELEASE });
    const r = await fetchLatestRelease({ fetcher, currentVersion: 'v0.2.138-alpha' });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(SOURCE_STATUS.OK);
    expect(r.url).toBe(RELEASE_SOURCE.latestReleaseUrl);
    expect(r.evaluation.status).toBe(UPDATE_STATUS.UPDATE_AVAILABLE);
  });

  it('handles an already-parsed JSON response (no .json method)', async () => {
    const fetcher = async () => GH_RELEASE;
    const r = await fetchLatestRelease({ fetcher });
    expect(r.status).toBe(SOURCE_STATUS.OK);
    expect(r.evaluation.latestVersion).toBe('0.2.999-alpha');
  });

  it('captures a thrown fetcher error as a safe MALFORMED state', async () => {
    const fetcher = async () => { throw new Error('network down'); };
    const r = await fetchLatestRelease({ fetcher });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(SOURCE_STATUS.MALFORMED);
    expect(r.errors.join(' ')).toMatch(/network down/);
  });

  it('notes a non-ok HTTP response but still evaluates the body', async () => {
    const fetcher = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await fetchLatestRelease({ fetcher });
    expect(r.errors.join(' ')).toMatch(/http 404/);
    expect(r.evaluation.status).toBe(UPDATE_STATUS.UNKNOWN);
  });
});

describe('SDK exposure', () => {
  it('exposes githubReleaseSource at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.githubReleaseSource.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.githubReleaseSource.evaluateFromSource).toBe('function');
    expect(typeof SDK.githubReleaseSource.selectLatestRelease).toBe('function');
  });
});
