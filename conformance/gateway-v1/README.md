<!-- SPDX-License-Identifier: CC0-1.0 -->
# Torii Gate v1 conformance kit

Connect your world to the Torii network, whatever engine or language you use. The protocol is in [`GATEWAY_PROTOCOL.md`](../../GATEWAY_PROTOCOL.md) and is short.

## What's here

| Path | What it is |
|---|---|
| `gate-v1.mjs` | The reference reader and writer check, about 200 lines of plain JS. Its only dependency is `@noble/curves`/`@noble/hashes`. Port it to any language; the fixtures tell you whether you got it right. |
| `fixtures/heartbeats.json` | 17 signed heartbeats (valid, forged, stale, hostile, future-version) plus a dedupe case, each with the expected reader result |
| `fixtures/travel.json` | Travel-URL and arrival cases |
| `check.mjs` | Checks your own heartbeat: `node check.mjs my-heartbeat.json` (add `--now 1792540800` to replay the fixtures) |
| `reference-world/` | A complete world with no 3D engine: it publishes, lists, travels and greets arrivals. Serve the folder over https. |
| `napplet/` | The gateway doorway (directory, peek bar, 入, ✕) as a sandboxed napplet. Mount it in an `<iframe sandbox="allow-scripts">` with `#c=<nonce>`; it asks, your host decides. The same files Torii Quest ships. Visit mode (`gate.peek {mode:'visit', host, confirm}`, `gate.stay`) and the arrival card (`#c=<nonce>&m=arrival`, `gate.arrival`) since v0.2.935. |
| `reference-world/doorway.html`, `doorway.mjs` | The reference world mounting that napplet with its own colours (`mountDoorway`). |

## Your world conforms when

1. Your heartbeat passes `check.mjs`.
2. Your reader gives the expected result for every case in `fixtures/` (list or skip, and the same sanitised fields).
3. Your travel and arrival code matches `fixtures/travel.json`.

Torii Quest runs these same fixtures in CI against its own code (`tests/gateway/gate-v1-conformance.test.js`).

## Licence

Use this kit in anything: open or closed, free or commercial, in any engine.
- **The code and fixtures** (`gate-v1.mjs`, `check.mjs`, `fixtures/`, `reference-world/`) are [0BSD](./LICENSE). No conditions, not even attribution, so copy, paste or port them freely.
- **This README and the protocol text** (`GATEWAY_PROTOCOL.md`) are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- **The rest of Torii Quest** is GPL-3.0.

## Notes

The keys in the fixtures are public test keys. Never use them for anything real. Regenerate the fixtures with `node tools/gen-gate-v1-fixtures.mjs`.
