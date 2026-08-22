// tests/torii-menu.test.js — pure model layer for the persistent Torii menu
// (Phase 0c). The DOM module (toriiMenu.js) mounts this model; these tests lock
// the guest/logged-in/owner gating, the scan badge text, the live "searching for
// worlds" state (NO mock worlds), + the fixed section order — all without a DOM.
import { describe, it, expect } from 'vitest';
import {
  normaliseToriiMenuState,
  toriiMenuBadgeText,
  shouldShowSearchingForWorlds,
  canShowFollowingSection,
  shouldShowLoginToTravelNote,
  toriiMenuSections,
  toriiMenuModelSnapshot,
  TORII_MENU_SECTION_ORDER,
} from '../src/engine/menu/toriiMenuModel.js';

const W = (title, extra = {}) => ({ title, ...extra });

describe('toriiMenuModel — normalisation', () => {
  it('normalises a full state snapshot + never throws on garbage', () => {
    const m = normaliseToriiMenuState({
      scanStatus: 'scanning', canTravel: true, isOwner: false,
      friends: [W('a')], following: [W('b')], games: [W('c')], all: [W('d')],
      onTravel: () => {}, admin: { heartbeatIntent: 'on' },
    });
    expect(m.scanStatus).toBe('scanning');
    expect(m.canTravel).toBe(true);
    expect(m.isOwner).toBe(false);
    expect(m.total).toBe(4);
    expect(typeof m.onTravel).toBe('function');
    // non-owner never receives admin data
    expect(m.admin).toBe(null);
  });

  it('coerces missing/invalid fields to safe empties', () => {
    const m = normaliseToriiMenuState(null);
    expect(m.scanStatus).toBe('idle');
    expect(m.canTravel).toBe(false);
    expect(m.total).toBe(0);
    expect(m.onTravel).toBe(null);
    expect(m.friends).toEqual([]);
  });

  it('drops non-object world entries from every section', () => {
    const m = normaliseToriiMenuState({ friends: [W('a'), null, 7, 'x', W('b')] });
    expect(m.friends).toHaveLength(2);
    expect(m.total).toBe(2);
  });

  it('rejects unknown scanStatus values', () => {
    expect(normaliseToriiMenuState({ scanStatus: 'bogus' }).scanStatus).toBe('idle');
    expect(normaliseToriiMenuState({ scanStatus: 'scanning' }).scanStatus).toBe('scanning');
    expect(normaliseToriiMenuState({ scanStatus: 'offline' }).scanStatus).toBe('offline');
  });
});

describe('toriiMenuModel — badge text', () => {
  it('scanning → SCANNING RELAYS', () => {
    expect(toriiMenuBadgeText({ scanStatus: 'scanning' })).toBe('● SCANNING RELAYS…');
  });
  it('offline → OFFLINE', () => {
    expect(toriiMenuBadgeText({ scanStatus: 'offline' })).toBe('● OFFLINE');
  });
  it('online with N nodes → ONLINE · N NODE(S)', () => {
    expect(toriiMenuBadgeText({ friends: [W('a')] })).toBe('● ONLINE · 1 NODE');
    expect(toriiMenuBadgeText({ friends: [W('a')], games: [W('b'), W('c')] })).toBe('● ONLINE · 3 NODES');
  });
  it('idle with zero nodes → NO NODES ONLINE', () => {
    expect(toriiMenuBadgeText({})).toBe('● NO NODES ONLINE');
  });
});

describe('toriiMenuModel — searching for worlds (no mock fallback)', () => {
  it('shows only while scanning with zero worlds', () => {
    expect(shouldShowSearchingForWorlds({ scanStatus: 'scanning' })).toBe(true);
    expect(shouldShowSearchingForWorlds({ scanStatus: 'scanning', friends: [W('a')] })).toBe(false);
    expect(shouldShowSearchingForWorlds({ scanStatus: 'idle' })).toBe(false);
  });
  it('never injects mock worlds — empty input yields zero worlds everywhere', () => {
    const m = normaliseToriiMenuState({});
    expect(m.total).toBe(0);
    expect(m.friends).toEqual([]);
    expect(m.following).toEqual([]);
    expect(m.games).toEqual([]);
    expect(m.all).toEqual([]);
    // scanning + zero worlds is the live "searching" state, not a mock list
    expect(shouldShowSearchingForWorlds({ scanStatus: 'scanning' })).toBe(true);
    const sections = toriiMenuSections({ scanStatus: 'scanning' });
    expect(sections.every((s) => s.worlds.length === 0)).toBe(true);
  });
});

describe('toriiMenuModel — guest / logged-in gating', () => {
  it('guests (no canTravel) cannot show the following section', () => {
    expect(canShowFollowingSection({})).toBe(false);
    expect(canShowFollowingSection({ canTravel: false })).toBe(false);
  });
  it('logged-in (canTravel) can show the following section', () => {
    expect(canShowFollowingSection({ canTravel: true })).toBe(true);
  });
  it('guests see a log-in hint for the following section, not its worlds', () => {
    const sections = toriiMenuSections({ canTravel: false, following: [W('a')] });
    const following = sections.find((s) => s.id === 'following');
    expect(following.gated).toBe(true);
    expect(following.worlds).toEqual([]); // guest never sees followed worlds
    expect(following.gatedHint).toBe('Log in to see who you follow.');
  });
  it('logged-in viewers see followed worlds in the following section', () => {
    const sections = toriiMenuSections({ canTravel: true, following: [W('a'), W('b')] });
    const following = sections.find((s) => s.id === 'following');
    expect(following.gated).toBe(false);
    expect(following.worlds).toHaveLength(2);
  });
});

describe('toriiMenuModel — login-to-travel hint', () => {
  it('shows only when nodes are online but the viewer cannot travel (guest)', () => {
    expect(shouldShowLoginToTravelNote({ canTravel: false, friends: [W('a')] })).toBe(true);
    expect(shouldShowLoginToTravelNote({ canTravel: false })).toBe(false);
    expect(shouldShowLoginToTravelNote({ canTravel: true, friends: [W('a')] })).toBe(false);
  });
});

describe('toriiMenuModel — owner / admin gating', () => {
  it('owner receives admin data; non-owner never does', () => {
    expect(normaliseToriiMenuState({ isOwner: true, admin: { heartbeatIntent: 'on' } }).admin).toEqual({ heartbeatIntent: 'on' });
    expect(normaliseToriiMenuState({ isOwner: false, admin: { heartbeatIntent: 'on' } }).admin).toBe(null);
  });
  it('the snapshot exposes admin visibility for owners only', () => {
    const snap = toriiMenuModelSnapshot({ isOwner: true, admin: { heartbeatIntent: 'on' } });
    expect(snap.isOwner).toBe(true);
    expect(snap.sections).toHaveLength(4);
  });
});

describe('toriiMenuModel — section order', () => {
  it('always renders the four sections in the fixed user-spec order', () => {
    const sections = toriiMenuSections({});
    expect(sections.map((s) => s.id)).toEqual(TORII_MENU_SECTION_ORDER);
    expect(sections.map((s) => s.title)).toEqual([
      'Mutuals', 'People you follow', 'Games & experiences', 'All live nodes',
    ]);
  });
  it('every section carries an honest empty hint', () => {
    for (const s of toriiMenuSections({})) {
      expect(typeof s.emptyHint).toBe('string');
      expect(s.emptyHint.length).toBeGreaterThan(0);
    }
  });
});
