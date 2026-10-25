// engine/location/worldPath.js — ADR-0147 M3: world location paths.
//
//   <app root>w/<npub>/<world>     e.g. /quest/w/npub1…/home
//
// Pure (no DOM): the shell, the runtime and tests share it. The app root is the
// path up to the `/w/npub1` marker (so a preview sub-path that happens to contain
// `/w/` is never mistaken for a world link). Everything is validated: the npub
// must be a well-formed bech32 npub and the world id a lowercase slug, so a
// crafted URL can never inject markup, path traversal or an odd relay into travel.

export const NPUB_RE = /^npub1[02-9ac-hj-np-z]{58}$/;
export const WORLD_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MARKER_RE = /\/w\/npub1/;

/** pathname → the app root ('/quest/' etc.), always ending in '/'. */
export function appRootOf(pathname) {
  const p = typeof pathname === 'string' && pathname.startsWith('/') ? pathname : '/';
  const i = p.search(MARKER_RE);
  if (i >= 0) return p.slice(0, i + 1);
  return p.replace(/[^/]*$/, '');
}

/**
 * pathname → { root, link: null } | { root, link: { npub, world } } |
 *            { root, link: null, error }.
 * A missing world id is null: "this owner's current world" (no filter).
 */
export function parseWorldPath(pathname) {
  const root = appRootOf(pathname);
  const p = typeof pathname === 'string' ? pathname : '';
  if (!MARKER_RE.test(p)) return { root, link: null };
  const rest = p.slice(root.length + 2).split('/').filter(Boolean); // after 'w/'
  if (rest.length < 1 || rest.length > 2) return { root, link: null, error: 'bad-shape' };
  let world = null;
  let npub = rest[0];
  try { npub = decodeURIComponent(rest[0]); if (rest[1] != null) world = decodeURIComponent(rest[1]); } catch { return { root, link: null, error: 'bad-encoding' }; }
  if (!NPUB_RE.test(npub)) return { root, link: null, error: 'bad-npub' };
  if (world !== null && !WORLD_ID_RE.test(world)) return { root, link: null, error: 'bad-world' };
  return { root, link: { npub, world } };
}

/** (root, npub, world?) → '<root>w/<npub>[/<world>]' or null when invalid. */
export function worldPathFor(root, npub, world = null) {
  if (!NPUB_RE.test(npub || '')) return null;
  if (world != null && !WORLD_ID_RE.test(world)) return null;
  const r = typeof root === 'string' && root.startsWith('/') ? (root.endsWith('/') ? root : root + '/') : '/';
  return world ? `${r}w/${npub}/${world}` : `${r}w/${npub}`;
}

/** location-like { origin, pathname } → the absolute app URL (never a world path). */
export function appUrlOf(loc) {
  const origin = loc && typeof loc.origin === 'string' ? loc.origin : '';
  return origin + appRootOf(loc && loc.pathname);
}
