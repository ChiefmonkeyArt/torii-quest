# ADR-0146: Licensing: Gate spec CC0, conformance kit 0BSD, Quest stays GPL-3.0

- **Status:** Accepted
- **Date:** 2026-10-22
- **Deciders:** chiefmonkey ("Ok go for it")
- **Related:** ADR-0143 (the Gate is the product), ADR-0144 (Gate v1 frozen + kit)

## Context

The whole repo was GPL-3.0. The Gate only spreads if other worlds, including closed-source and commercial engines, can copy the reference reader into their game or port it, and can copy, translate or merge the spec text into their own docs or a NIP.

- **GPL on the kit:** it would bind any game that includes it, and even ports are unclear.
- **GPL on the spec:** it protects nothing, because copyright covers the words, not the protocol. It only adds friction to quoting and translating.

All commits to the relicensed files are by the owner (ChiefmonkeyArt), so the owner can relicense them.

## Decision

| Files | Licence | SPDX |
|---|---|---|
| `GATEWAY_PROTOCOL.md`, `conformance/gateway-v1/README.md` | CC0 1.0 Universal (public domain dedication) | `CC0-1.0` |
| `conformance/gateway-v1/**` code and fixtures, `reference-world/`, `tools/gen-gate-v1-fixtures.mjs` | Zero-Clause BSD | `0BSD` |
| Everything else (Torii Quest) | GPL-3.0, unchanged | — |

- **License texts:**
  - `LICENSES/0BSD.txt` and `LICENSES/CC0-1.0.txt`, from the official SPDX texts;
  - `conformance/gateway-v1/LICENSE`, so a copied folder carries its licence.
- **Notices.** Source files carry `SPDX-License-Identifier` headers. The root README lists the exceptions.
- **Test.** `tests/gateway/gate-licensing.test.js` keeps the headers, files and notices in place.

## Why these choices

- **0BSD over MIT.** It has no notice-keeping condition, so pasting code into game scripts can never be a breach. It's approved by the Open Source Initiative and is public-domain-equivalent.
- **0BSD over CC0 for code.** CC0 explicitly withholds a patent licence, and the FSF and OSI don't recommend it for software.
- **CC0 for text.** It has no conditions, which makes for the cleanest route into a NIP. The missing patent grant doesn't matter for prose. CC-BY was considered (credit required) and declined to keep copying frictionless.

## Consequences

- Any engine, open or closed, can adopt the Gate with no licence questions.
- **Control of the standard** comes from the v1 version, the public fixtures, the "Torii Gate" name and the ADR process, not from copyright.
- **Contributions.** Future changes to these files are accepted under the same licences.
- **No other changes.** Quest's code, assets and the rest of `docs/` stay GPL-3.0. Nothing about runtime behaviour or the bundle changes.
