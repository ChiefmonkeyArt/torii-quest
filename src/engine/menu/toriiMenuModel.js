// engine/menu/toriiMenuModel.js — the PURE decision layer for the persistent
// Torii menu (Phase 0c). Extracts the guest/logged-in/owner gating, the scan
// badge text, the "searching for worlds" state, + the ordered section list out
// of the DOM module (toriiMenu.js) so they are unit-testable without a browser.
//
// Pure + node-safe: no `document`, no `three`, no fetch, no signing, no relay
// publish, no timers. Never fakes data; never references or injects mock worlds.
// The DOM layer (toriiMenu.js) renders from this model — behavior is unchanged,
// only the decision logic is now separable + testable.
//
// Constraints by construction (mirrors toriiMenu.js):
//   - normalise never throws; missing/invalid fields default to safe empties.
//   - a world row is a plain object; non-objects are dropped from every section.
//   - no code path produces or references MOCK_WORLDS / mock worlds.

export const TORII_MENU_MODEL_VERSION = 1;

// The fixed section order the menu renders (mirrors the user spec):
//   1. Mutuals (the people you + they follow — "murals follows" first)
//   2. People you follow (gated: logged-in / can-travel only)
//   3. Games & experiences
//   4. All live nodes
export const TORII_MENU_SECTION_ORDER = ['mutuals', 'following', 'games', 'all'];

const _VALID_SCAN = new Set(['idle', 'scanning', 'offline']);

// Keep only plain-object world rows from a raw (possibly untrusted) array.
function _worlds(arr) {
  return Array.isArray(arr) ? arr.filter((w) => w && typeof w === 'object') : [];
}

// normaliseToriiMenuState(state) → a canonical model the DOM layer renders from.
// Accepts the raw getState() snapshot; never throws; carries NO mock data.
export function normaliseToriiMenuState(state) {
  const st = state && typeof state === 'object' ? state : {};
  const friends = _worlds(st.friends);
  const following = _worlds(st.following);
  const games = _worlds(st.games);
  const all = _worlds(st.all);
  const total = friends.length + following.length + games.length + all.length;
  const scanStatus = _VALID_SCAN.has(st.scanStatus) ? st.scanStatus : 'idle';
  const canTravel = !!st.canTravel;
  const isOwner = !!st.isOwner;
  return {
    scanStatus,
    canTravel,
    isOwner,
    friends,
    following,
    games,
    all,
    total,
    onTravel: typeof st.onTravel === 'function' ? st.onTravel : null,
    // admin panel is owner-only; a non-owner never receives admin data.
    admin: isOwner && st.admin && typeof st.admin === 'object' ? st.admin : null,
  };
}

// toriiMenuBadgeText(state) — the header scan/online badge. The visible node
// count is the SUM of the four sections' filtered rows (consistent with what
// the menu actually renders — a non-object entry never counts as a node).
export function toriiMenuBadgeText(state) {
  const m = normaliseToriiMenuState(state);
  if (m.scanStatus === 'scanning') return '● SCANNING RELAYS…';
  if (m.scanStatus === 'offline') return '● OFFLINE';
  if (m.total) return `● ONLINE · ${m.total} NODE${m.total === 1 ? '' : 'S'}`;
  return '● NO NODES ONLINE';
}

// shouldShowSearchingForWorlds(state) — true only while scanning with zero
// discovered worlds. This is the live "searching for worlds" state the user
// requires INSTEAD of any mock/fake world fallback.
export function shouldShowSearchingForWorlds(state) {
  const m = normaliseToriiMenuState(state);
  return m.scanStatus === 'scanning' && m.total === 0;
}

// canShowFollowingSection(state) — the "People you follow" section renders live
// followed worlds only when the viewer can travel (is logged in). A guest sees a
// log-in hint instead of followed worlds.
export function canShowFollowingSection(state) {
  return normaliseToriiMenuState(state).canTravel;
}

// shouldShowLoginToTravelNote(state) — the footer "login with nostr to travel"
// hint shows only when nodes ARE online but the viewer cannot travel (guest).
export function shouldShowLoginToTravelNote(state) {
  const m = normaliseToriiMenuState(state);
  return !m.canTravel && m.total > 0;
}

// toriiMenuSections(state) — the ordered, normalised section list the DOM layer
// renders. Order is fixed (TORII_MENU_SECTION_ORDER). The "following" section
// carries `gated: true` when the viewer cannot travel; the DOM layer renders a
// log-in hint for a gated section instead of its (empty) world list.
export function toriiMenuSections(state) {
  const m = normaliseToriiMenuState(state);
  return [
    { id: 'mutuals', title: 'Mutuals', worlds: m.friends, emptyHint: 'No mutuals online yet', gated: false, gatedHint: null },
    {
      id: 'following',
      title: 'People you follow',
      worlds: m.canTravel ? m.following : [],
      emptyHint: 'No followed worlds online',
      gated: !m.canTravel,
      gatedHint: 'Log in to see who you follow.',
    },
    { id: 'games', title: 'Games & experiences', worlds: m.games, emptyHint: 'No games online yet', gated: false, gatedHint: null },
    { id: 'all', title: 'All live nodes', worlds: m.all, emptyHint: 'No other nodes online', gated: false, gatedHint: null },
  ];
}

// toriiMenuModelSnapshot(state) — a single serialisable summary for dashboards /
// handoff (not used by the DOM render). Exposes the gating verdicts + counts.
export function toriiMenuModelSnapshot(state) {
  const m = normaliseToriiMenuState(state);
  return {
    version: TORII_MENU_MODEL_VERSION,
    scanStatus: m.scanStatus,
    canTravel: m.canTravel,
    isOwner: m.isOwner,
    total: m.total,
    counts: { friends: m.friends.length, following: m.following.length, games: m.games.length, all: m.all.length },
    badge: toriiMenuBadgeText(m),
    searchingForWorlds: shouldShowSearchingForWorlds(m),
    showLoginToTravelNote: shouldShowLoginToTravelNote(m),
    sections: toriiMenuSections(m).map((s) => ({ id: s.id, title: s.title, count: s.worlds.length, gated: s.gated })),
  };
}
