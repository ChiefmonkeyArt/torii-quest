import {
  readLatestAccessSettings,
  fanoutReq,
  RELAYS as DEFAULT_RELAYS,
} from '../../src/nostr.js';
import { readLatestFollowSet } from '../../src/engine/gateway/handoffArrival.js';
import {
  WRITE_POLICY_OWNER_ONLY,
  WRITE_POLICY_FOLLOWS_WRITE,
  assertWriteAuthority,
} from '../../src/engine/gateway/writeAuthority.js';

const HEX64 = /^[0-9a-f]{64}$/;

function normaliseHex64(value) {
  const pubkey = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return HEX64.test(pubkey) ? pubkey : '';
}

function normaliseRelays(relays) {
  const list = Array.isArray(relays) ? relays : (typeof relays === 'string' ? relays.split(',') : []);
  return [...new Set(list.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))];
}

export function deriveWriteAuthorityInstanceId(env = process.env) {
  const direct = [
    env.QUEST_INSTANCE_ID,
    env.TORII_INSTANCE_ID,
    env.INSTANCE_ID,
    env.PUBLIC_INSTANCE_ID,
  ].find((value) => typeof value === 'string' && value.trim());
  if (direct) return direct.trim();

  const origin = [env.PUBLIC_ORIGIN, env.APP_ORIGIN, env.ORIGIN, env.SITE_ORIGIN].find((value) => typeof value === 'string' && value.trim());
  if (origin) {
    try {
      const url = new URL(origin.trim());
      const path = (url.pathname || '/').replace(/\/+$/, '') || '/';
      return `${url.host}${path}`;
    } catch {
      // Fall through to host/path assembly.
    }
  }

  const host = [env.PUBLIC_HOST, env.APP_HOST, env.SITE_HOST, env.HOSTNAME].find((value) => typeof value === 'string' && value.trim());
  if (!host) return '';
  const path = [env.PUBLIC_PATH, env.APP_PATH, env.SITE_PATH, env.BASE_PATH].find((value) => typeof value === 'string') || '/';
  const normalisedPath = (path.trim() || '/').replace(/\/+$/, '') || '/';
  return `${host.trim()}${normalisedPath.startsWith('/') ? normalisedPath : `/${normalisedPath}`}`;
}

export async function resolveWriteAuthorityFacts(opts = {}) {
  const actorPubkey = normaliseHex64(opts.actorPubkey);
  const ownerPubkey = normaliseHex64(opts.ownerPubkey);
  const relays = normaliseRelays(opts.relays && opts.relays.length ? opts.relays : DEFAULT_RELAYS);
  const request = typeof opts.request === 'function' ? opts.request : fanoutReq;
  const instanceId = typeof opts.instanceId === 'string' ? opts.instanceId.trim() : '';
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? Math.floor(opts.timeoutMs) : 5000;
  const graceMs = Number.isFinite(opts.graceMs) && opts.graceMs >= 0 ? Math.floor(opts.graceMs) : 250;
  const retries = Number.isFinite(opts.retries) && opts.retries >= 0 ? Math.floor(opts.retries) : 1;

  const facts = {
    actorPubkey,
    actorTrust: actorPubkey ? 'crypto-verified' : 'anon',
    ownerPubkey,
    writePolicy: WRITE_POLICY_OWNER_ONLY,
    delegateSet: new Set(),
    followsOwner: 'unknown',
  };
  const meta = {
    accessSettingsError: null,
    followsError: null,
    relays,
    instanceId,
  };

  if (!actorPubkey || !ownerPubkey || !instanceId) {
    return { facts, meta };
  }
  if (actorPubkey === ownerPubkey) {
    facts.followsOwner = true;
    return { facts, meta };
  }

  const accessRes = await readLatestAccessSettings({
    request,
    relays,
    instanceId,
    ownerPubkey,
    timeoutMs,
    graceMs,
    retries,
  });
  if (accessRes.ok && accessRes.settings) {
    facts.writePolicy = accessRes.settings.writePolicy || WRITE_POLICY_OWNER_ONLY;
    facts.delegateSet = new Set(Array.isArray(accessRes.settings.delegateSet) ? accessRes.settings.delegateSet : []);
  } else {
    meta.accessSettingsError = accessRes.error || 'access-settings-unavailable';
  }

  if (facts.writePolicy === WRITE_POLICY_FOLLOWS_WRITE) {
    const followsRes = await readLatestFollowSet({
      request,
      relays,
      subjectPubkey: actorPubkey,
      visitorPubkey: actorPubkey,
      ownerPubkey,
      mode: 'follows-only',
      timeoutMs,
      graceMs,
      retries,
    });
    if (followsRes.ok) {
      facts.followsOwner = followsRes.followedPubkeys.has(ownerPubkey);
    } else {
      meta.followsError = followsRes.error || 'follow-graph-unavailable';
    }
  }

  return { facts, meta };
}

export async function assertResolvedWriteAuthority(opts = {}) {
  const { facts, meta } = await resolveWriteAuthorityFacts(opts);
  const verdict = assertWriteAuthority(facts);
  return { verdict, facts, meta };
}
