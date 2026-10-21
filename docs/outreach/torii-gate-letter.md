# Torii Gate: invitation letter (living draft, NOT SENT)

> **Status:** draft v1, 2026-10-21. **Do not send yet.** The operator's instruction is that this is not sent until a lot more of Quest is done, and that it will go to many people.
>
> Before every send, re-run the checklist, refresh the facts table, and rewrite the letter from the template.

## Before sending: all must be true

- [ ] **Quest is ready:**
  - real-GPU playtests are smooth (no freezes in `perf.hitches`);
  - the cold load is fast;
  - mobile/PWA touch is acceptable.
- [ ] **The Gate works end to end:**
  - two independent operators' worlds travel both ways, from a fresh browser;
  - G1 (v1 frozen) and G2 (conformance kit) are shipped;
  - G3 has at least one non-Quest world, or a credible partner ready to try.
- [ ] **The kit is public, documented and licensed for reuse.** The spec and kit licence is an owner decision: today the repo is GPL-3.0, and a permissive licence (MIT or CC0) for `GATEWAY_PROTOCOL.md` and `conformance/` would make adoption by any engine easier.
- [ ] **A 60–90 s video** of a hop between two worlds.
- [ ] **The sending identity is chosen and approved:** which npub or email, and from which account. Each send is approved separately.
- [ ] **The facts table below has been re-checked** against the live repo, and no claim goes beyond what's shipped.

## Facts to refresh before each send

| Fact | Value at draft time | Source |
|---|---|---|
| Quest version | v0.2.909-alpha | `release-metadata.json` on the live site |
| Gate protocol | v1 frozen (ADR-0144) | `GATEWAY_PROTOCOL.md` |
| Conformance kit | 17 signed heartbeat cases + dedupe, 13 travel/arrival cases, CLI, reference world | `conformance/gateway-v1/` |
| Worlds on the network | (count live heartbeats on public relays) | reference world → "Find worlds" |
| Non-Quest worlds | 0 (the reference world is ours) | — |
| Live URL | https://chiefmonkey.art/quest/ | — |
| Repo | https://github.com/ChiefmonkeyArt/torii-quest | — |

## Template: the full letter

Subject: An open door between Nostr worlds

Hi {name},

I'm chiefmonkey, and I build Torii Quest ({live url}), a browser world on Nostr and Bitcoin. Your work on {their project, one specific thing you admire} is a big part of why I think games on Nostr can be more than single islands.

While building Quest, I realised the most useful thing I'd made wasn't the world. It was the gate between worlds. So I've turned it into a small open protocol, the **Torii Gate**, and I'd love for {their project} to be part of it.

What it is:
- **A heartbeat.** A world says "I'm open, land here" with one signed Nostr event (kind 30078, a 20-minute expiry).
- **A directory.** Any world can read those heartbeats, check the signatures, and list who's live.
- **A hop.** A player travels by visiting the destination's https page with their pubkey attached. The destination decides who it admits.

That's all. There's no central server, no Torii code to run, and no engine or language requirement. If your world can sign a Nostr event and serve a landing page, it can join. Multiplayer endpoints and node-to-node transports are optional extras on top.

To make it easy to adopt, there's a conformance kit ({kit url}):
- signed test fixtures;
- a ~200-line reference reader you can port;
- a checker for your own heartbeat;
- a complete world built with no 3D engine at all.

Quest runs the same fixtures in CI, so the spec and the code can't drift apart.

{One paragraph tailored to them, for example: "NGE already handles networking inside a game with Nostr as the coordinator. The Gate is the missing piece between games: an NGE world could list Quest, and Quest players could walk into an NGE world."}

Would you be up for a short call, or for trying a hop between {their project} and Quest? I'll do the integration work on my side, and anything you find awkward in the spec is exactly the feedback I need before we propose it as a NIP.

Here's a {60–90 s} video of a hop: {video url}

Thanks for building in the open,
chiefmonkey
{npub} · {live url}

## Short variants

**Engine and tool builders** (two lines for DMs):
> I've made an open way for Nostr worlds to link up: one signed heartbeat, a directory, a hop. Any engine, no server. There's a conformance kit and a world with no engine to copy from. Want to try a hop between {project} and Torii Quest? {kit url}

**World operators and creators:**
> Your world can appear in every Torii doorway, and your players can visit others', by publishing one signed event. Here's the 10-minute guide: {kit url}

**Public post** (Nostr note):
> The Torii Gate v1 is frozen: an open protocol for travelling between Nostr worlds, whatever they're built with. Heartbeat, directory, hop. There's a conformance kit and a reference world with no 3D engine. Build a world, open a door. {kit url} #nostr #gamedev

## First recipients (when the checklist is green)

| Who | Why | Angle |
|---|---|---|
| Nostr Game Engine (NGE) developers | A Nostr-native engine, OpenSats-funded; it handles networking inside a game, not between games | "NGE worlds in the Torii directory; Quest players walking into NGE worlds" |
| Other Nostr game and world builders | They gain players from other worlds for one event | The short variant |
| Relay operators and client devs | Heartbeats are ordinary kind-30078 events | The NIP draft preview |

## Change log

- 2026-10-21: first draft (v0.2.909-alpha). Not sent.
