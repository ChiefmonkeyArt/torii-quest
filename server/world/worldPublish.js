// server/world/worldPublish.js — ADR-0119 slice 4: the beacon's publish half of
// world-as-data. Serializes the node's ACTIVE world into a validated, hash-stable
// version:1 manifest, uploads it to Blossom, signs a torii-world reference with the
// beacon's own key, and publishes it to the relays a traveller reads.
//
// The resolver (worldResolver.resolveWorldByNpub / _gwOpenVisit) discovers the
// reference by the presence SIGNER's pubkey (the beacon key when the server beacon
// is enabled), so the beacon signs the reference with its OWN key and it is found.
//
// Heightfields are injected (buildArenaHeightfieldArray / buildNapHeightfieldArray
// from src/terrain/heightmap.js — pure + node-safe) so this module stays free of
// terrain specifics; the host (arena-ws.js) passes the serialized legacy config +
// the sampled zones.

import { serializeArenaWorld } from '../../src/engine/world/arenaSerialize.js';
import { prepareWorldReference, publishWorldReference } from '../../src/engine/world/worldPublisher.js';
import { sha256Hex } from '../../src/engine/world/worldResolver.js';
import { uploadBlossomText } from './blossomUpload.js';
import { DEFAULT_BLOSSOM_SERVER } from '../../src/engine/world/worldReference.js';
import {
  ARENA_GRID, NAP_GRID, ARENA_TERRAIN, NAP_TERRAIN,
  buildArenaHeightfieldArray, buildNapHeightfieldArray,
} from '../../src/terrain/heightmap.js';

const HEX64 = /^[0-9a-f]{64}$/i;

// _zone({rows, cols, scale, offset, heights}) — one portable terrain zone. Mirrors
// the legacy createHeightfield convention (physics.js): rows=rowsZ, cols=colsX,
// scale=[gWidth,1,gDepth] (total extents), offset=[gCenterX,0,gCenterZ] (centre).
function _zone(grid, terrain, heights) {
  return {
    rows: grid.rowsZ,
    cols: grid.colsX,
    scale: [terrain.gWidth, 1, terrain.gDepth],
    offset: [terrain.gCenterX, 0, terrain.gCenterZ],
    heights: heights, // Float32Array (column-major col*rows + row), length rows*cols
  };
}

/**
 * buildWorldZones() → [{rows,cols,scale,offset,heights}, …] — the arena + NAP
 * heightfield zones sampled from the deterministic tomoe generator. Matches the
 * terrain a traveller will walk on (physics.js buildWorldTerrain / legacy buildArena).
 */
export function buildWorldZones() {
  return [
    _zone(ARENA_GRID, ARENA_TERRAIN, buildArenaHeightfieldArray()),
    _zone(NAP_GRID, NAP_TERRAIN, buildNapHeightfieldArray()),
  ];
}

/**
 * buildWorldManifest({ worldId, legacy, zones, name }) → { ok, manifestJson, world }
 * Serializes the legacy config + sampled heightfield zones into the portable
 * manifest. Pure translation; fails loudly on an unrenderable world.
 */
export function buildWorldManifest({ worldId, legacy, zones, name } = {}) {
  const r = serializeArenaWorld({ worldId, legacy, zones, name });
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'serialize-failed' };
  return { ok: true, manifestJson: r.manifestJson, world: r.world };
}

/**
 * publishWorld({ manifestJson, worldId, relays, blossomServer, version, signEvent,
 *                relayPub, fetchImpl, nowMs }) → Promise<{ ok, manifestHash, error }>
 * The end-to-end publish: upload the manifest to Blossom (hash-verified), then
 * sign + publish the world-reference event. Never rejects.
 */
export async function publishWorld({
  manifestJson, worldId, relays = [], blossomServer = DEFAULT_BLOSSOM_SERVER, version,
  signEvent, relayPub, fetchImpl, nowMs,
} = {}) {
  const fail = (error) => ({ ok: false, error });

  if (typeof manifestJson !== 'string' || !manifestJson) return fail('bad-manifest');
  if (typeof signEvent !== 'function') return fail('sign-event-required');
  if (typeof relayPub !== 'function') return fail('relay-pub-required');
  if (typeof fetchImpl !== 'function') return fail('fetch-required');

  const manifestHash = sha256Hex(manifestJson);
  const server = (typeof blossomServer === 'string' && blossomServer.trim() ? blossomServer.trim() : DEFAULT_BLOSSOM_SERVER);

  const up = await uploadBlossomText({
    text: manifestJson,
    server,
    expectedHex: manifestHash,
    signEvent,
    fetchImpl,
    nowMs,
  });
  if (!up.ok) return fail('upload-failed:' + (up.error || 'unknown'));
  if (up.sha256 !== manifestHash) return fail('hash-mismatch');

  const pub = await publishWorldReference({
    worldJson: manifestJson,
    worldId,
    relays,
    blossomServer: server,
    version,
    uploadBlob: async () => ({ ok: true, sha256: manifestHash }),
    signEvent,
    relayPub,
  });
  if (!pub.ok) return fail('publish-failed:' + (pub.reason || 'unknown'));

  return { ok: true, manifestHash, error: null };
}

/**
 * worldReferenceForManifest({ manifestJson, worldId, relays, blossomServer, version }) →
 *   { ok, manifestHash, unsigned }. Pure mint of the reference (for the beacon to
 * sign + publish with its own key via its injected finalize/publishToRelay).
 */
export function worldReferenceForManifest({ manifestJson, worldId, relays, blossomServer, version } = {}) {
  if (typeof manifestJson !== 'string' || !manifestJson) return { ok: false, error: 'bad-manifest' };
  const prep = prepareWorldReference({ worldJson: manifestJson, worldId, relays, blossomServer, version });
  if (!prep) return { ok: false, error: 'bad-manifest' };
  return { ok: true, manifestHash: prep.manifestHash, unsigned: prep.unsigned };
}