// tests/update-preview.test.js — torii.quest update-check PREVIEW block
// (updatePreview.js, LEAN-5, v0.2.142). Asserts the block is render-ready,
// surfaces the running version / sampled latest release / update status / GitHub
// releases path, carries an explicit MANUAL/NO-AUTO-UPDATE badge, and is inert:
// actionable:false / readOnly:true, never exposing a fetch/install/navigate action.
import { describe, it, expect } from 'vitest';
import {
  updatePreviewBlock, statusLabel, UPDATE_PREVIEW_BADGE, STATUS_TEXT,
} from '../src/engine/update/updatePreview.js';
import { UPDATE_STATUS, RELEASE_SOURCE } from '../src/engine/update/updateCheck.js';
import { VERSION } from '../src/config.js';
import * as SDK from '../src/sdk/index.js';

const NEWER = Object.freeze({
  tag_name: 'v0.2.999-alpha',
  name: 'Torii Quest v0.2.999-alpha',
  html_url: 'https://github.com/torii-quest/torii-quest/releases/tag/v0.2.999-alpha',
  body: 'Bigger arena, new nostrich skins, Chiefmonkey balance pass.',
  published_at: '2026-06-24T00:00:00Z',
});

describe('statusLabel', () => {
  it('maps known statuses and upper-cases unknowns', () => {
    expect(statusLabel(UPDATE_STATUS.UPDATE_AVAILABLE)).toBe('UPDATE AVAILABLE');
    expect(statusLabel(UPDATE_STATUS.UP_TO_DATE)).toBe('UP TO DATE');
    expect(statusLabel(UPDATE_STATUS.UNKNOWN)).toBe('UNKNOWN');
    expect(statusLabel('weird')).toBe('WEIRD');
    expect(statusLabel()).toBe('UNKNOWN');
  });

  it('exposes a frozen status-text map', () => {
    expect(STATUS_TEXT[UPDATE_STATUS.UPDATE_AVAILABLE]).toBe('UPDATE AVAILABLE');
    expect(Object.isFrozen(STATUS_TEXT)).toBe(true);
  });
});

describe('updatePreviewBlock', () => {
  it('produces an inert update-available block', () => {
    const b = updatePreviewBlock(NEWER, { currentVersion: 'v0.2.138-alpha' });
    expect(b.title).toBe('UPDATE CHECK PREVIEW');
    expect(b.badge).toBe(UPDATE_PREVIEW_BADGE);
    expect(b.status).toBe(UPDATE_STATUS.UPDATE_AVAILABLE);
    expect(b.statusLabel).toBe('UPDATE AVAILABLE');
    expect(b.updateAvailable).toBe(true);
    expect(b.currentVersion).toBe('v0.2.138-alpha');
    expect(b.latestVersion).toBe('0.2.999-alpha');
    expect(b.actionable).toBe(false);
    expect(b.readOnly).toBe(true);
  });

  it('orders lines: Version, Latest, Status, Source, Notes', () => {
    const b = updatePreviewBlock(NEWER, { currentVersion: 'v0.2.138-alpha' });
    expect(b.lines.map((l) => l.label)).toEqual(['Version', 'Latest', 'Status', 'Source', 'Notes']);
    expect(b.lines[0].value).toBe('v0.2.138-alpha');
    expect(b.lines[1].value).toBe('0.2.999-alpha');
    expect(b.lines[2].value).toBe('UPDATE AVAILABLE');
  });

  it('surfaces the GitHub releases page path as display-only text', () => {
    const b = updatePreviewBlock(NEWER, { currentVersion: 'v0.2.138-alpha' });
    expect(b.source).toBe(RELEASE_SOURCE.releasesPageUrl);
    expect(b.lines.find((l) => l.label === 'Source').value).toBe(RELEASE_SOURCE.releasesPageUrl);
  });

  it('reports up-to-date when runtime matches the release', () => {
    const b = updatePreviewBlock({ tag_name: 'v0.2.138-alpha' }, { currentVersion: 'v0.2.138-alpha' });
    expect(b.status).toBe(UPDATE_STATUS.UP_TO_DATE);
    expect(b.statusLabel).toBe('UP TO DATE');
    expect(b.updateAvailable).toBe(false);
  });

  it('degrades a draft/unparseable release to UNKNOWN without throwing', () => {
    const draft = updatePreviewBlock({ tag_name: 'v9.9.9', draft: true });
    expect(draft.status).toBe(UPDATE_STATUS.UNKNOWN);
    expect(draft.statusLabel).toBe('UNKNOWN');
    const bad = updatePreviewBlock({});
    expect(bad.status).toBe(UPDATE_STATUS.UNKNOWN);
    expect(bad.lines.find((l) => l.label === 'Latest').value).toBe('—');
  });

  it('defaults the running version to the runtime VERSION', () => {
    const b = updatePreviewBlock({ tag_name: VERSION });
    expect(b.currentVersion).toBe(VERSION);
    expect(b.status).toBe(UPDATE_STATUS.UP_TO_DATE);
  });

  it('caps the notes preview to a single capped line', () => {
    const long = 'word '.repeat(200);
    const b = updatePreviewBlock({ tag_name: 'v0.2.999-alpha', body: long }, { notesMax: 40 });
    expect(b.notesPreview.length).toBeLessThanOrEqual(40);
    expect(b.notesPreview).not.toContain('\n');
  });

  it('never exposes a fetch/install/update/navigate action key', () => {
    const b = updatePreviewBlock(NEWER, { currentVersion: 'v0.2.138-alpha' });
    for (const key of ['fetch', 'install', 'update', 'navigate', 'href', 'onClick', 'autoUpdate']) {
      expect(b).not.toHaveProperty(key);
    }
  });
});

describe('SDK exposure', () => {
  it('exposes updatePreview at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.updatePreview.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.updatePreview.updatePreviewBlock).toBe('function');
  });
});
