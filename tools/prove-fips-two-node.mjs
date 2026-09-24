// Run as root in a disposable Linux test host with iproute2, nftables + TUN:
// node tools/prove-fips-two-node.mjs /path/fips /path/fipsctl /path/mesh.nft
// Creates two isolated namespaces, then removes only its own resources.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { meshAddress } from '../server/presence/fipsPresence.js';

assert.equal(process.getuid(), 0, 'run only on a disposable root-capable test host');
const [daemon, ctl, firewall] = process.argv.slice(2).map(p => resolve(p));
const applyFirewall = process.env.TORII_PROOF_SKIP_FIREWALL !== '1';
const dir = mkdtempSync(`${tmpdir()}/torii-fips-proof-`);
const fixture = fileURLToPath(new URL('./fips-proof-peer.mjs', import.meta.url));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000 });
const children = [];
const namespaces = [];
const nodes = [];
function start(ns, command, args) {
  const child = spawn('ip', ['netns', 'exec', ns, command, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    child.output = (child.output + data.toString()).slice(-8192);
  });
  children.push(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 20 && child.exitCode === null; i++) await delay(50);
  if (child.exitCode === null) child.kill('SIGKILL');
}
async function read(node) {
  return JSON.parse(run('ip', ['netns', 'exec', node.ns, process.execPath, fixture, 'read', `${node.dir}/peer.json`]));
}
async function eventually(fn, label) {
  let error;
  for (let i = 0; i < 12; i++) {
    try { return await fn(); } catch (e) { error = e; await delay(250); }
  }
  throw new Error(`${label}: ${error?.message}\n${children.map(c => c.output).join('\n').slice(-8192)}`);
}
try {
  for (let i = 0; i < 2; i++) {
    const ns = `tf${process.pid}${i}`;
    run('ip', ['netns', 'add', ns]);
    namespaces.push(ns);
    const nodeDir = `${dir}/${i}`;
    mkdirSync(nodeDir);
    run(ctl, ['keygen', '--dir', nodeDir]);
    const npub = readFileSync(`${nodeDir}/fips.pub`, 'utf8').trim();
    const mesh = run(ctl, ['address', '--key', `${nodeDir}/fips.pub`]).trim();
    assert.equal(new URL(`http://[${meshAddress(npub)}]`).hostname, new URL(`http://[${mesh}]`).hostname);
    const key = generateSecretKey(), owner = getPublicKey(generateSecretKey());
    const created_at = Math.floor(Date.now() / 1000);
    const event = finalizeEvent({
      kind: 30078, created_at,
      tags: [['d', 'quest-torii'], ['t', 'torii-gateway'], ['p', owner],
        ['expiration', String(created_at + 1200)]],
      content: JSON.stringify({ zoneId: 'quest-torii', website: `https://node${i}.example/quest/`, zoneType: 'arena' }),
    }, key);
    writeFileSync(`${nodeDir}/event.json`, JSON.stringify(event));
    nodes.push({ ns, dir: nodeDir, npub, mesh, event, owner, ip: `10.231.0.${i + 1}` });
  }
  run('ip', ['link', 'add', 'tfproof-a', 'type', 'veth', 'peer', 'name', 'tfproof-b']);
  for (let i = 0; i < 2; i++) {
    const node = nodes[i], other = nodes[1 - i], device = i ? 'tfproof-b' : 'tfproof-a';
    run('ip', ['link', 'set', device, 'netns', node.ns]);
    run('ip', ['-n', node.ns, 'addr', 'add', `${node.ip}/24`, 'dev', device]);
    run('ip', ['-n', node.ns, 'link', 'set', device, 'up']);
    run('ip', ['-n', node.ns, 'link', 'set', 'lo', 'up']);
    if (applyFirewall) run('ip', ['netns', 'exec', node.ns, 'nft', '-f', firewall]);
    writeFileSync(`${node.dir}/fips.yaml`, JSON.stringify({
      node: { identity: { persistent: true }, log_level: 'warn',
        control: { socket_path: `${node.dir}/control.sock` } },
      tun: { enabled: true, name: 'fips0', mtu: 1280 }, dns: { enabled: false },
      transports: { udp: { bind_addr: `${node.ip}:2121` } },
      peers: [{ npub: other.npub, addresses: [{ transport: 'udp', addr: `${other.ip}:2121` }] }],
    }));
    writeFileSync(`${node.dir}/peer.json`, JSON.stringify({ version: 1, peers: [{
      transportNpub: other.npub, beaconPubkey: other.event.pubkey, ownerPubkey: other.owner,
      zoneId: 'quest-torii', website: `https://node${1 - i}.example/quest/`,
    }] }));
    node.process = start(node.ns, daemon, ['-c', `${node.dir}/fips.yaml`]);
  }
  for (const node of nodes) {
    await eventually(() => {
      assert.match(run('ip', ['-n', node.ns, '-6', 'addr', 'show', 'dev', 'fips0']), /inet6 fd/);
    }, 'TUN startup');
    node.relay = start(node.ns, process.execPath, [fixture, 'serve', `${node.dir}/event.json`, node.mesh]);
    await eventually(() => assert.match(node.relay.output, /ready/), 'relay startup');
  }
  const startAt = Date.now();
  for (let i = 0; i < 2; i++) await eventually(async () => {
    const result = await read(nodes[i]);
    assert.equal(result.id, nodes[1 - i].event.id);
    assert.equal(result.via, 'fips');
  }, 'bidirectional signed heartbeat');
  const firstExchangeMs = Date.now() - startAt;
  const rssKiB = nodes.map(n => Number(readFileSync(`/proc/${n.process.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]));
  if (applyFirewall) for (let i = 0; i < 2; i++) {
    assert.match(run('ip', ['netns', 'exec', nodes[i].ns, process.execPath, fixture,
      'probe-admin', '-', nodes[1 - i].mesh]), /admin-isolated/);
  }
  // Same key after restart; loss of FIPS must not produce false-positive receipt.
  await stop(nodes[1].process);
  assert.equal((await read(nodes[0])).id, null);
  nodes[1].process = start(nodes[1].ns, daemon, ['-c', `${nodes[1].dir}/fips.yaml`]);
  await eventually(async () => assert.equal((await read(nodes[0])).id, nodes[1].event.id), 'recovery');
  assert.equal(readFileSync(`${nodes[1].dir}/fips.pub`, 'utf8').trim(), nodes[1].npub);
  // A forged original and an expired original are rejected over real FIPS.
  writeFileSync(`${nodes[1].dir}/event.json`, JSON.stringify({ ...nodes[1].event, sig: '0'.repeat(128) }));
  assert.equal((await read(nodes[0])).id, null);
  console.log(JSON.stringify({
    proof: 'PASS', transport: 'FIPS v0.5.1 UDP/TUN, two network namespaces',
    bidirectional: true, outageRejected: true, recovery: true, persistentIdentity: true,
    forgedRejected: true, wildcardAdminBlocked: applyFirewall ? true : 'not-run-kernel-lacks-nftables',
    firstExchangeMs, daemonRssKiB: rssKiB,
    limitations: 'Fixture relays, not production strfry. No VPS rollout, player frame-time or long soak claim.',
  }, null, 2));
} finally {
  for (const child of children.reverse()) await stop(child);
  for (const ns of namespaces) run('ip', ['netns', 'delete', ns]);
  rmSync(dir, { recursive: true, force: true });
}
