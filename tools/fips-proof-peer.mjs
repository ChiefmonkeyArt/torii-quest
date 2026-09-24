// Isolated-network proof fixture. Never connects to production relays.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { parsePeerConfig, queryHeartbeat } from '../server/presence/fipsPresence.js';

const [mode, file, host] = process.argv.slice(2);
if (mode === 'serve') {
  const server = new WebSocketServer({ host, port: 7778, maxPayload: 1024 });
  server.on('connection', socket => socket.on('message', data => {
    const message = JSON.parse(data);
    if (message[0] !== 'REQ') return;
    const event = JSON.parse(readFileSync(file, 'utf8'));
    socket.send(JSON.stringify(['EVENT', message[1], event]));
    socket.send(JSON.stringify(['EOSE', message[1]]));
  }));
  server.on('listening', () => console.log('ready'));
  // Deliberately wildcard-bound, to verify default-deny protection.
  createServer((req, res) => res.end('not-for-mesh')).listen(8080, '::');
} else if (mode === 'read') {
  const peer = parsePeerConfig(JSON.parse(readFileSync(file, 'utf8')))[0];
  const event = await queryHeartbeat(peer.meshUrl, peer);
  console.log(JSON.stringify({ id: event?.id || null, via: event ? 'fips' : null }));
} else if (mode === 'probe-admin') {
  try {
    await fetch(`http://[${host}]:8080/`, { signal: AbortSignal.timeout(500) });
    process.exitCode = 1;
  } catch { console.log('admin-isolated'); }
} else throw new Error('unknown proof mode');
