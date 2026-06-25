# Torii Quest — SDK & Debug Surface Index

> **Status:** discoverability index (v0.2.187-alpha). A one-page map of the public
> SDK namespaces, the four MVP proof surfaces, and the read-only `ToriiDebug.shells`
> reports — for AI handoffs and FOSS contributors. **Everything listed here is pure
> and inert:** no network, no signing/publishing, no auto-update, and no navigation —
> with ONE narrow exception: `handoffExecute` (v0.2.168), now LIVE-WIRED behind the
> `gatewayActivation` (v0.2.178) confirmation gate, can change a SAFE same-origin
> route — but ONLY through an explicitly injected host transport AND only after a
> literal `confirmed:true` clears the consent + route-allowlist gates; with no
> transport / no confirmation it is a dry-run no-op, and it never touches
> `window.location`/external URLs at module scope (the window is injected).
> Source of truth for the SDK surface is `src/sdk/index.js` (`SDK_SURFACE`); for the
> debug reports it is `src/engine/debug/shellReport.js`. See `CODE_INDEX.md` for the
> full file-by-file map and `HANDOFF.md` for onboarding.

---

## 1. SDK entrypoint

`import * as torii from 'src/sdk/index.js'` (or destructure namespaces). It re-exports
ONLY pure, node-safe leaf modules — nothing transitively imports `scene.js`, so the
SDK loads in a plain node/vitest env. Each surface carries a `STABILITY` tier in the
frozen `SDK_SURFACE` map; `surfacesByTier(tier)` lists names at a tier.

- `SDK_VERSION` — tracks `config.js` `VERSION`.
- `STABILITY` — `{ STABLE, EXPERIMENTAL, INTERNAL }`.
- `SDK_SURFACE` — `{ name: { tier, module } }` (module `null` = forward-declared internal).

### STABLE namespaces (locked by tests; safe to depend on)

| Namespace | Module | What it is |
|---|---|---|
| `aim` | `engine/combat/aim.js` | barrel→crosshair aiming (`crosshairPoint`/`aimDirection`/`CONVERGE_DIST`) |
| `classifier` | `engine/combat/classifier.js` | head-vs-body hit geometry |
| `damage` | `engine/combat/damage.js` | head/body damage + kill-threshold contract |
| `interactions` | `engine/physics/interactions.js` | allocation-free `nudgeImpulse`/`applyNudge` |
| `raycastService` | `engine/physics/raycastService.js` | injectable raycast facade (`createRaycastService`, `raycastService`) |
| `reloadPose` | `engine/weapons/reloadPose.js` | reload viewmodel dip curve |
| `muzzle` | `engine/weapons/muzzle.js` | muzzle/barrel world-position math |

### EXPERIMENTAL namespaces (work + tested; shape may change)

`botAgent`, `snapshot`, `phaseScreens`, `component`, `registry`, `toriiGateway`,
`productDisplay`, `productPanel`, `productPanelShell`, `productPreview`,
`travelIntent`, `gatewayHandoff`, `gatewayPortal`, `gatewayPreview`, `leaderboard`,
`leaderboardPublisher`, `leaderboardView`, `leaderboardPreview`, `relayRead`, `leaderboardRelayRead`, `profileRead`,
`consentGate`, `consentView`, `submitIntent`, `gatewayRead`, `travelConfirm`, `handoffPlan`, `handoffExecute`, `hostTransport`, `gatewayActivation`, `gatewayPortalActivation`, `portalTrigger`, `zoneRoute`, `portalMeshPlan`, `zoneLabel`, `updateCheck`,
`updatePreview`, `githubReleaseSource`, `updateStatus`, `mvpLoop`, `proofSurfaceSpecs`, `anchorTransforms`.

`relayRead` (NOSTR-READ, v0.2.159) is the pure READ-ONLY Nostr relay adapter
foundation: `validateRelayUrl` (ws/wss only, no credentials),
`normalizeRelayEvent`/`validateRelayEvent` (NIP-01 shape, no crypto verify),
`eventMatchesFilter` (NIP-01 filter semantics), `buildReqMessage`/`buildCloseMessage`
(READ frames only — no EVENT/publish builder), and
`createReadOnlyRelayAdapter({request})` whose injected host-only transport feeds a
frozen `{read,readOnly:true}` adapter that NEVER signs/publishes/opens-a-socket/throws.

`leaderboardRelayRead` (NOSTR-READ / LB-1, v0.2.160) is the pure READ-ONLY leaderboard
relay-read proof on top of `relayRead`: `buildScoreFilter` builds the kind-30000
`#t:torii-quest` score filter; `extractScoreFromEvent` rebuilds a local score from a
normalised event (JSON content + indexable-tag fallback, runId from the `d` tag);
`dedupeScores` keeps the newest event per addressable pubkey+runId; and
`readLeaderboardEvents(input,opts)` consumes a relayRead `read()` result / events array /
local sample, normalises→validates→extracts→dedupes→ranks (via `leaderboardView.rankScores`)
into a read-only `{ok,filter,count,rows,scores,skipped,duplicates,signed:false,published:false,readOnly:true,errors}`
report. NEVER signs/publishes/opens-a-socket/auto-connects/throws on event data.

`profileRead` (NOSTR-READ / IDENTITY, v0.2.161) is the pure READ-ONLY Nostr identity/
profile proof on top of `relayRead`: `buildProfileFilter` builds the kind:0 profile
filter; `safeProfileUrl` keeps ONLY https absolute URLs as INERT data strings (no DOM
`<img src>`); `shortPubkey` truncates a hex key for display; `parseProfileMetadata`
parses the JSON metadata or degrades to `{}`; `extractProfileFromEvent` builds a
sanitised display-only identity view-model (name/displayName/about/picture/banner/
nip05/lud16/website + shortPubkey, displayName fallback display_name→name→short pubkey);
`selectNewestProfiles` keeps the newest profile per pubkey (kind:0 replaceable); and
`readProfiles(input,opts)` consumes a relayRead `read()` result / events array / local
sample, normalises→validates→extracts→selects-newest into a read-only
`{ok,filter,count,profiles,skipped,duplicates,signed:false,published:false,readOnly:true,errors}`
report. NEVER signs/publishes/opens-a-socket/auto-connects/throws on event data.

`consentGate` (CONSENT-1 / SEC-1 precursor, v0.2.162) is the pure, inert consent
boundary every future write/sign/publish/update/travel action must pass before it may
touch the wire. `CONSENT_ACTIONS` is a frozen known-action registry — a read tier
(`leaderboard:read`/`profile:read`/`relay:read`, always allowed) and a write tier
(`nostr:publish`/`profile:update`/`leaderboard:submit`/`update:apply`/`gateway:travel`,
grant-gated). `buildConsentRequest` builds a flat request; `summariseConsent` renders
one human-readable line; `evaluateConsent(req|id,grant)` returns an INERT
`{action,allowed,blocked,reason,requiresConsent,write,signed,danger,summary,performed:false,readOnly:true,errors}`
decision — reads always allowed, writes allowed ONLY with an explicit matching grant
(boolean `true` or scoped `{granted,action,token}`; a grant for one action never
authorises another). `requestConsent` folds build+evaluate+summary into one report.
NEVER performs an action (`performed:false` always) and exposes NO
sign/publish/send/connect/submit/apply/travel method — `allowed:true` is permission for
the host to act later, never an action taken here.

`submitIntent` (LB-SUBMIT / SEC-1 precursor, v0.2.163) is the pure, inert leaderboard
SUBMIT INTENT/PREVIEW routed through `consentGate`. `sanitizeSubmitMeta` sanitises the
identity/game block (name strips control chars + HTML angle brackets and caps 64 chars;
npub lowercase-bech32 only; pubkey 64-char lowercase hex only; unsafe/absent → null —
no unsafe URLs/HTML). `buildSubmitDraft(input)→{ok,draft?|errors?}` combines a validated
score (`leaderboard.js`) with the sanitised identity into the inert UNSIGNED kind-30000
draft a host WOULD later sign+publish (`signed:false`/`published:false`), degrading a
malformed score to `ok:false`. `summariseSubmit` renders one stable preview-only line.
`prepareSubmitIntent(input,grant)` routes the intent through
`evaluateConsent('leaderboard:submit',grant)` and returns an INERT
`{ok,action,draft,consent,summary,signed:false,published:false,performed:false,readOnly:true,errors}`
— BLOCKED with no grant (`consent-required`), allowed ONLY with an explicit matching
grant (a grant for a different action → `consent-mismatch`), and a malformed score
`ok:false` even WITH a grant; with a matching grant consent is marked allowed but the
flow STILL never signs/publishes/sends/connects/writes (`performed:false` pinned).

`gatewayRead` (GATEWAY / NAP-zone handoff, v0.2.164) is the pure READ-ONLY gateway
DESTINATION-RECORD read proof on top of the v0.2.159 relay boundary. `buildGatewayFilter`
builds the kind-30078 `#t:torii-gateway` NIP-01 filter. `extractGatewayFromEvent(event)→{ok,gateway?|errors?}`
reconstructs a sanitised travel-preview model (`zoneId`/`title`/`description`/`zoneType`/
`npub`/`pubkey`/`shortPubkey`/`website`/`banner`/`relays`/`topics`/`created_at`/`trust`) from a
NORMALISED gateway event — zone id anchored to the `d` tag (rejects records with none); all
text control/markup-stripped; website/banner https-only via `safeProfileUrl`; relays ws/wss-only
+ credential-free + deduped via `validateRelayUrl`; npub via `looksLikeNpub`; zoneType ∈
nap/arena/shop/gallery; `trust:'unverified'`. `dedupeGateways` keeps the newest record per
addressable `pubkey+zoneId`. `readGateways(input,options)` accepts a relayRead `read()` result /
bare events array / `{events}` / local sample, runs each item normalise→validate→extract
(failures land in `skipped`), dedupes newest-per-zone, and returns a read-only
`{ok,filter,count,gateways,skipped,duplicates,navigated:false,signed:false,published:false,performed:false,readOnly:true,errors}`
— degrading an unusable shape to `ok:false` with an empty list and NEVER throwing/navigating/
signing/publishing/opening a socket.

`travelConfirm` (GATEWAY / NAP-zone handoff, v0.2.165) is the pure READ-ONLY gateway travel
CONFIRMATION/INTENT behind the v0.2.162 consent gate, consuming the v0.2.164 gatewayRead preview
model. `sanitizeDestination(input)→{ok,destination?|errors?}` accepts EITHER a `gatewayRead`
preview model OR a plain destination descriptor (idempotent), anchored to a required `zoneId`,
control/markup-stripping text, https-only website via `safeProfileUrl`, ws/wss credential-free
relays via `validateRelayUrl` (deduped/capped), `looksLikeNpub` npub, 64-hex pubkey, known
`zoneType` (nap/arena/shop/gallery); no-zoneId/malformed → `ok:false`, never throws.
`summariseTravelConfirm(input)` renders one stable preview-only line. `prepareTravelIntent(input,grant)`
routes the destination through `evaluateConsent('gateway:travel',grant)` and returns an INERT
`{ok,action,destination,consent,summary,navigated:false,performed:false,signed:false,published:false,readOnly:true,errors}`
— BLOCKED with no grant (`consent-required`), allowed ONLY with an explicit matching grant
(boolean `true` or scoped `{granted,action,token}`; a grant for a different action → `consent-mismatch`),
a malformed destination `ok:false` even WITH a grant; an allowed grant marks consent allowed but
STILL never navigates/signs/publishes/sends/connects (`navigated:false`/`performed:false` pinned).
Exposes NO navigate/goto/sign/publish/send/connect/open/apply method.

`consentView` (CONSENT-2, v0.2.166) is the pure CONSENT UX VIEW-MODEL over the v0.2.162
consent gate — it turns gate requests/decisions into clear, user-facing PROMPT copy + preview
rows BEFORE any real confirm-button wiring exists. `CONSENT_PROMPT_BADGE`='CONSENT · PREVIEW ·
NO ACTION'; `CONSENT_SEVERITY` (info/caution/danger); `REASON_TEXT` (human copy per reason);
`ACTION_COPY` (per-action `{headline,actionLabel,cancelLabel}` for the 5 write actions).
`copyForAction(id,requiresConsent)` returns the copy bag (read-only + unknown fall back).
`severityFor(decision)` maps read/no-consent→info, low-danger write→caution, high-danger
write→danger. `consentPromptView(input,grant)` re-shapes a decision into an INERT render-ready
view `{title,badge,action,kind,severity,headline,bodyLines:[{label,value}],actionLabel,
cancelLabel,requiresExplicitConsent,allowed,blocked,reason,reasonText,write,signed,danger,
statusLine,performed:false,actionable:false,readOnly:true,errors}` — blocked-by-default for
writes, ALLOWED copy under a matching grant but STILL `performed:false`/`actionable:false`,
malformed/unknown → a safe blocked view, every free-form string (origin) control/markup-stripped
so no `<`/`>` can inject markup. `consentPromptRows(grants)` → one inert row per known action.
Exposes NO confirm/sign/publish/send/connect/travel/navigate/apply method — a rendered
"Travel"/"Publish" label is COPY, not a wired button.

`handoffPlan` (GATEWAY / NAP-zone handoff, v0.2.167) is the pure HOST TRAVEL HANDOFF SEAM —
it consumes a `gateway:travel` intent (`prepareTravelIntent` output, see [[travelConfirm]]) plus
an optional injected host context and produces an INERT dry-run handoff/rollback PLAN, the last
safe seam before v0.2.168 can implement a first controlled local/same-site travel action.
`HANDOFF_PLAN_VERSION`=1; `HANDOFF_BADGE`='HANDOFF · DRY-RUN · NO NAVIGATION'; `HANDOFF_STATUS`
(ready/blocked/invalid); `HANDOFF_COMMANDS` names the FUTURE steps (preflight/snapshotState/
unloadWorld/navigate/loadWorld/spawnPlayer) as STRINGS only — none are executed.
`safeRoutePath(raw)` allows only a single-segment same-origin `/path` fragment;
`handoffRouteFor(destination)` yields `/zone/<slug>` or null; `handoffUrlFor(destination)` reuses
profileRead.safeProfileUrl (https-only external preview string or null). `summariseHandoff(input,
grant,hostContext)` is the one-line digest. `planHandoff(input,grant,hostContext)` returns the
inert plan `{action,status,ok,reason,targetZoneId,targetRoute,targetUrl,currentRoute,rollbackRoute,
preflight:[...],commands,summary,dryRun:true,navigated:false,worldReloaded:false,performed:false,
signed:false,published:false,readOnly:true,errors}` — status precedence invalid>blocked>ready,
READY only under a matching consent grant, blocked-by-default otherwise, malformed/unsafe
route+url fields sanitised to null. Host `window.location` is NEVER read at runtime — currentRoute
comes from the injected `hostContext` so the module stays node-testable. Exposes NO
navigate/goto/open/reload/unload/sign/publish/send/connect/apply method.

`handoffExecute` (GATEWAY / NAP-zone handoff, v0.2.168) is the FIRST acting travel EXECUTOR — it
consumes a v0.2.167 [[handoffPlan]] `status:'ready'` dry-run plan and performs a SAFE same-origin
route change, but ONLY through an explicitly injected host transport, and never by touching
`window.location`/`history.pushState`/`location.href`/`window.open`/`reload` itself. `EXECUTE_VERSION`=1;
`EXECUTE_BADGE`='TRAVEL · SAME-ORIGIN · HOST-TRANSPORT'; `EXECUTE_STATUS`
(done/no-op/blocked/failed/rolled-back). `isHostTransport(t)` is true only for a non-array object with a
`navigate` function. `executeHandoff(plan,transport,opts)` (1) requires a ready plan — anything else →
BLOCKED `plan-not-ready`; (2) re-validates `plan.targetRoute` with `safeRoutePath` (defense in depth) →
BLOCKED `unsafe-target-route`; the external `targetUrl` is NEVER executed; (3) with no transport or
`opts.dryRun` → NO-OP (`no-transport`/`dry-run`); (4) optionally calls `transport.snapshot()`; (5) calls
`transport.navigate(targetRoute)` ONCE inside try/catch — a thrown error OR a `false` return is a failure;
(6) on success → DONE/`ok:true`/`navigated:true`/`performed:true`; on failure, attempts a SINGLE
synchronous rollback (no timers) via `transport.rollback(rollbackRoute)` when present → ROLLED-BACK if the
rollback succeeds, else FAILED, with a `rollback:{attempted,ok,route}` record and any rollback throw
captured in `errors`. `executeHandoffFor(input,grant,transport,opts)` folds `planHandoff`+`executeHandoff`.
The report PINS `external:false`, `worldReloaded:false`, `signed:false`, `published:false`, `network:false`
LAST, so a tampered/sneaky plan can never flip a safety flag; `navigated`/`performed` are true ONLY when the
injected navigate actually succeeded. Default debug/SDK use injects NO transport, so it stays a dry-run
no-op and never moves the live app. Exposes NO bare open/reload/goto/assign/href/pushState/replaceState/
redirect/location/unload method.

`hostTransport` (GATEWAY / NAP-zone handoff, v0.2.170) is the same-origin HOST TRANSPORT ADAPTER
the v0.2.168 [[handoffExecute]] executor drives — the controlled, injectable seam between
`executeHandoff` and a real router/history, scoped to same-origin route changes ONLY.
`HOST_TRANSPORT_VERSION`=1; `HOST_TRANSPORT_BADGE`='TRANSPORT · SAME-ORIGIN · HISTORY-PUSHSTATE'.
`isRouteHost(host)` accepts a bare callable OR an object exposing a `pushState` function.
`createHostTransport(host,{home,onLog})` normalises the host into bound `push`/`replace`/`read`
thunks (a bare fn → push/replace = the fn, read = null; an object → push from `pushState`, replace
from `replaceState` with a push fallback, read from `getRoute` else null) and returns an
executor-compatible `{navigate,snapshot,rollback,log}` — or `null` when there is no usable host, so
`executeHandoff` safely NO-OPs (the "missing host no-op" contract). `navigate(route)` re-validates
via `safeRoutePath` and pushes ONLY a safe same-origin path (external/protocol-relative/unsafe →
logged reject + `false`); `snapshot()` reads+sanitises the current route (fallback `home`);
`rollback(route?)` replaces to a safe target / the saved snapshot / home — `rollback()` with no
argument is the back-home escape. `createRecordingHost(initialRoute='/')` is the DEFAULT-SAFE
in-memory host (records `pushState`/`replaceState` calls in `host.calls`, never really navigates)
used by the debug shell + tests. `createBrowserHostTransport(win,opts)` is the runtime SEAM:
returns `null` without `win.history.pushState`, and otherwise builds the host using ONLY
`win.history.pushState`/`replaceState` + `win.location.pathname+search` (NO reload/href/open) — it
is provided but NOT yet wired into the live app. Browser APIs are fully isolated behind the injected
host, so the module is pure/node-safe and never throws; it exposes NO bare browser-navigation method
at module scope.

`gatewayActivation` (GATEWAY / NAP-zone handoff, v0.2.178) is the LIVE-WIRE ACTIVATION seam that
finally lets the [[handoffExecute]] executor ACT on a confirmed same-origin hop. `ACTIVATION_VERSION`=1;
`ACTIVATION_BADGE`='GATEWAY · CONFIRMED · SAME-ORIGIN HOP'. `resolveHostTransport(source,opts)→{transport,kind}`
picks a transport WITHOUT navigating: an `isHostTransport` object passes through as `injected`; a
window-shaped object (`history.pushState`) becomes a `browser` [[hostTransport]] via
`createBrowserHostTransport`; an `isRouteHost` host becomes a `host` transport via `createHostTransport`;
anything else is `none`. `activateGatewayHandoff(input,grant,opts)` is the gated act: it ALWAYS builds the
dry-run [[handoffPlan]] first (inert/auditable), then enforces three gates IN ORDER — (1) `opts.confirmed`
must be the literal boolean `true` (any truthy-but-not-true value → `UNCONFIRMED`, and the transport is
NEVER resolved), (2) the consent-gated plan must be `ok` (missing grant / unidentifiable destination →
`BLOCKED`), (3) the planned `targetRoute` must pass the optional `routeAllowlist` prefix check
(`route-not-allowed` → `BLOCKED`). Only after all three does it resolve a transport (from
`opts.transport`/`opts.window`/`opts.host`) and call `executeHandoff`. `live` is true only on the real
browser-window path. Status maps to `ACTIVATION_STATUS` (`NAVIGATED`/`UNCONFIRMED`/`NO_TRANSPORT`/`BLOCKED`/
`ROLLED_BACK`/`FAILED`); a failed navigate rolls back to the rollback route (back-home) when the transport
supports it. The report pins `external`/`worldReloaded`/`signed`/`published`/`network` = `false`. `DEMO_ACTIVATION_OPTS`
is a frozen confirmed-with-`/zone/`-allowlist preset. Pure/node-safe (the browser window is injected, never
reached at module scope). Reachable read-only via `ToriiDebug.shells.gatewayActivation(...)` /
`gatewayActivationReport(...)`, which drive a `createRecordingHost` so the debug path NEVER live-navigates.
Wiring this seam to a real host router (injected app/browser window + CSP-scoped allowlist) and an in-world
portal mesh is the next deferred step.

`gatewayPortalActivation` (GATEWAY / NAP-zone portal boundary, v0.2.180) is the pure PORTAL-BOUNDARY seam
that bridges an in-world gateway COMPONENT to the [[gatewayActivation]] confirmed same-origin hop.
`PORTAL_ACTIVATION_VERSION`=1; `PORTAL_ACTIVATION_BADGE`='GATEWAY PORTAL · CONFIRMED · SAME-ORIGIN HOP';
`DEFAULT_PORTAL_ALLOWLIST` is a frozen `['/zone/']` (a meaningful scoped prefix — NEVER `['/']`);
`PORTAL_STATE` = `idle`/`armed`/`navigated`/`blocked`. `portalActivationInput(component,context)` maps
`gatewayDestination(component).target`→`zoneId` and DROPS the external `website` (so an external profile URL
is never built or navigated), carrying only title/zoneType/npub/relays; a non-gateway component or a
destination with no target is rejected. `sanitizePortalAllowlist(allowlist)` keeps only same-origin string
prefixes (`/`-leading, length ≥2) and FOLDS `['/']`→`['/zone/']` (stronger than the executor's fail-closed —
the boundary can never be permit-everything). `withinPortalRange(playerPos,portalPos,radius=3)` is a scalar
squared-distance compare (NO `Vector3` allocation, hot-path safe). `activatePortalHandoff(component,context,grant,opts)`
builds the input, sanitises the allowlist, and DELEGATES to `activateGatewayHandoff` (so all three v0.2.178
gates still apply — `confirmed===true`, consent-gated `plan.ok`, route-allowlist prefix), wrapping the result
in a `_portalReport` that pins `external`/`worldReloaded`/`signed`/`published`/`network` = `false`.
`createGatewayPortalBoundary(opts)` captures the injected window/transport/host ONCE at construction and is a
one-shot `arm(component,context)`→`confirm(grant,extra)` controller (`cancel()`/`state()`/`armed()`/
`routeAllowlist()`/`stagedZoneId()`); `confirm` sets `confirmed:true` and delegates, refusing with reason
`not-armed` if not armed. Pure/node-safe (the browser window is injected, never reached at module scope; no
bare navigation method). Reachable read-only via `ToriiDebug.shells.gatewayPortalActivation(...)` /
`gatewayPortalActivationReport(...)`, which drive a `createRecordingHost` so the debug path NEVER live-navigates.
Wiring an actual in-world portal MESH + proximity trigger that calls `arm`/`confirm` against a real injected
browser host is the next deferred step.

`portalTrigger` (GATEWAY / NAP-zone portal proximity, v0.2.181) is the pure PROXIMITY→CONFIRM controller that
finally wires an in-world portal position to the [[gatewayPortalActivation]] `createGatewayPortalBoundary` —
proximity ARMS/PREVIEWS but NEVER navigates; only an explicit player interaction (KeyF) confirms.
`PORTAL_TRIGGER_VERSION`=1; `PORTAL_PROMPT_TEXT`='Press F to travel'.
`createPortalTrigger({boundary,component,context,portalPos,range=3,onPrompt,promptText})` returns
`{tick(playerPos),interact(grant=true),isArmed(),inRange(),promptShown(),reset(),portalPos(),range()}`. `tick`
uses the v0.2.180 `withinPortalRange` scalar compare (NO `Vector3` allocation); on ENTERING range it calls
`boundary.arm(component,context)` + emits the prompt, on LEAVING it calls `boundary.cancel()` + hides the prompt
— state changes ONLY on transitions, returning `{inRange,armed,changed}`. `interact(grant)` acts ONLY when the
boundary is `armed()`, delegating to `boundary.confirm(grant)` (so all three v0.2.178 gates + the `['/zone/']`
allowlist still apply), clears the prompt, and returns the activation report or `null`. `reset()` cancels +
clears the prompt. Pure/node-safe — exposes NO bare navigate/open/reload/goto/assign/href/pushState method; NO
window/THREE/DOM (the boundary, which captured the injected window ONCE at construction, is injected); never
throws. WIRED in `main.js` (composition root ONLY): the trigger's `tick` runs in `update()` while `isPlaying()`
(else `reset()`), with a KeyF `onKeyDown` handler calling `interact(true)`; `hud.js` `showPortalPrompt`/
`hidePortalPrompt` render a lazy `#portal-prompt` div (opacity crossfade, no `setTimeout`). Reachable read-only
via `ToriiDebug.shells.portalTrigger(...)` / `portalTriggerReport(...)`, which drive a `createRecordingHost`
boundary so the debug path NEVER live-navigates. A dedicated portal MESH + SPA `/zone/<slug>` route handler
(so a hard refresh resolves the zone) is the next deferred infra step.

`zoneRoute` (GATEWAY / NAP-zone, v0.2.182) is the pure SPA `/zone/<slug>` route parser/resolver — the safe
client-side READ of the same-origin URL state the [[portalTrigger]] hop pushes, so a refresh/deep-link on
`/zone/*` is not brittle. `ZONE_ROUTE_VERSION`=1; `ZONE_ROUTE_BADGE`='ZONE ROUTE · SAME-ORIGIN · INERT';
`ZONE_ROUTE_PREFIX`='/zone/'; `ZONE_SLUG_MAX_LEN`=64; `ZONE_ROUTE_KIND`={HOME,ZONE,INVALID};
`DEMO_ZONE_ROUTE`='/zone/plebeian-market-bazaar'. `isValidZoneSlug(slug)` (strict: lowercase alnum words joined
by single hyphens, ≤64, no lead/trail/double hyphen), `humanizeZoneSlug(slug)` (Title Case or ''),
`zoneRouteFor(slug)` (`/zone/<slug>` or `null`), `parseZoneRoute(path)` and `describeZoneRoute(path)`.
`parseZoneRoute` runs the route through the v0.2.179-hardened [[handoffPlan]] `safeRoutePath` FIRST (non-string/
empty/over-length/dot-dot/percent/protocol-relative/`javascript:`/`data:`/markup/control/whitespace → INVALID),
strips a trailing `?query`/`#hash`, then classifies HOME (root `/` or any non-`/zone/` same-origin path), ZONE
(valid slug), or INVALID (sub-path `/zone/a/b`, malformed slug, hostile); a valid zone returns an INERT display
state `{kind,ok,slug,zoneId,route,title,notice}`. `navigated`/`performed`/`external`/`signed`/`published`/
`network` ALL pinned false — it interprets a URL, never acts. Pure/node-safe — NO module-scope `window`/THREE/DOM,
exposes NO navigate/open/reload/goto/assign/href/pushState method; never throws. WIRED in `main.js` (composition
root ONLY): reads `window.location.pathname` once on startup + on `popstate`, calling `hud.js`
`showZoneNotice`/`hideZoneNotice` (lazy `#zone-notice` div, opacity crossfade, no `setTimeout`). Reachable
read-only via `ToriiDebug.shells.zoneRoute(...)` / `zoneRouteReport(...)`. **Hard-refresh deep-link resolution
needs a static-host SPA fallback (serve `index.html` for `/zone/*`) — see HANDOFF.md §7 / GATEWAY_PROTOCOL.md;
documented, NOT faked in app code.**

`portalMeshPlan` (GATEWAY / NAP-world, v0.2.183) is the pure render PLAN for a dedicated visible in-world
portal marker at the existing [[portalTrigger]] position — so the player can SEE the travel point they are
approaching. `PORTAL_MESH_PLAN_VERSION`=1; `PORTAL_MESH_BADGE`='PORTAL MESH · DISPLAY-ONLY · INERT';
`PORTAL_MESH_GROUP`='gateway-portal'; `DEMO_PORTAL_MESH_OPTS`={position:{x:20,y:0,z:0},range:3,title:
'Plebeian Market Bazaar'}. `buildPortalMeshPlan(opts)` returns an INERT plan `{ok,anchor,range,ringRadius,
count,parts,rendered,...,reasons}` — 4 parts (outer-ring torus whose `ringRadius`===trigger `range`, violet
inner-ring, transparent beam cylinder, spinning core octahedron); every part + the plan itself pin
`navigated`/`performed`/`external`/`signed`/`published`=false, `readOnly`=true, `actionable`=false. Degrades to
`ok:false` with `invalid-position`/`range-defaulted` reasons on bad input; never throws. Pure/node-safe — NO
module-scope `window`/THREE/DOM. The browser-only adapter `portalMesh.js` (`buildPortalMesh(scene,opts)`,
`tickPortalMesh(dt)`, `disposePortalMesh()`, `portalMeshRenderState()`) consumes the plan, builds emissive
`MeshStandardMaterial` meshes ONCE behind a `_built` guard under `PORTAL_MESH_GROUP`, ticks allocation-free
(scalar rotation + emissive pulse only — no new Vector3/Matrix4, no per-frame geometry/material), and disposes/
reuses on teardown. WIRED in `main.js` (composition root ONLY): `buildPortalMesh(scene,…)` once + `tickPortalMesh
(dt)` in the loop. The visual is DISPLAY-ONLY: it changes nothing in the safety model — proximity still only
ARMS, KeyF confirms, same-origin `/zone/` only. Reachable read-only via `ToriiDebug.shells.portalMeshPlan(...)` /
`ToriiDebug.shells.portalMesh()` / `portalMeshPlanReport(...)`.

`zoneLabel` (GATEWAY / NAP-zone clarity, v0.2.184) is the pure portal/zone state-CLARITY label pair — it tells
the player WHERE the [[portalTrigger]] portal goes and WHAT they entered after a hop, without touching the
navigation-safety model. `ZONE_LABEL_VERSION`=1; `ZONE_LABEL_BADGE`='ZONE LABEL · DISPLAY-ONLY · INERT';
`DEFAULT_PORTAL_KEY`='F'; `DEFAULT_ENTERED_PREFIX`='Entered'; `DEMO_ZONE_LABEL_OPTS`={slug:'plebeian-market-bazaar',
key:'F'}. `portalPromptLabel({slug,route,title,key})` builds a target-aware proximity prompt ("Press F to travel
to Plebeian Market Bazaar"), falling back to the generic "Press F to travel" when no target is known;
`enteredZoneLabel(input,{prefix})` builds the concise post-hop notice ("Entered: Plebeian Market Bazaar"),
returning `''` for an unknown/empty target. Both DERIVE their human text from the safe slug via the [[zoneRoute]]
`humanizeZoneSlug` (alnum by construction); the internal `_titleFrom` strips the `ZONE_ROUTE_PREFIX` and, for any
non-slug/free-form/hostile string, runs an allowlist sanitiser `_safeTitle` (`[A-Za-z0-9 -]` only, collapse
whitespace, cap 80) so NO markup/dangerous token survives even though the HUD sink is `textContent`. WIRED in
`main.js` (composition root ONLY): the [[portalTrigger]] `promptText` is `portalPromptLabel({slug:'plebeian-market-
bazaar'})`, and the KeyF handler shows `showZoneNotice(enteredZoneLabel(rep.zoneId))` ONLY when the [[gatewayPortalActivation]]
`confirm()` report returns `navigated:true` with a string `zoneId` (a pushState hop does NOT fire popstate, so the
existing `_applyZoneRoute()` never refreshed the notice). DISPLAY-ONLY + INERT — no network/relay/sign/publish/
external nav; the safety model is unchanged (proximity ARMS, KeyF confirms, same-origin `/zone/` only). Pure/node-
safe — NO module-scope `window`/THREE/DOM; never throws. Reachable read-only via `ToriiDebug.shells.zoneLabel(opts?)`
/ `zoneLabelReport(opts?)`, which return label previews + a `safe` flag proving hostile input is stripped.

`continuum` (PROGRESS-1 / project oversight, v0.2.171) is the pure Torii Continuum
project-oversight DASHBOARD data + renderer — the FIRST slice of a broader oversight surface.
`CONTINUUM` holds the curated `progress.md` snapshot (metrics, a clearly-flagged SEED
contributors/clankers metric, tracks, the 15-hour `leanRoute`, activeNow/next12/archive/
completed24h, risks, sourceOfTruth) + `CONTINUUM_VERSION`/`CONTINUUM_BADGE`. Pure helpers:
`escapeHtml`, `clampPct` (0..100|null), `barCells`, `ringDash`, `computeTotals(data)` (headline
counts + pocProgressPct/buildProgressPct/milestonesAchievedPct), `buildContinuumModel()`,
`continuumDataJSON(model)` (the packaged JSON snapshot), and `renderContinuumPage(model)` → a
self-contained dark-cyberpunk static HTML string (CSS bars + 3 SVG donut rings + totals strip +
Now/Next/Later + next-12 + struck completed-24h + archive + source-of-truth footer). Renders fully
WITHOUT JS; a SAME-ORIGIN-only refresh script re-reads `./continuum-data.json` (no external URL/
eval/timers). `tools/build-continuum.mjs` (in `npm run build`) writes `public/continuum.html` +
`public/continuum-data.json` each build, so a page refresh shows the latest PACKAGED state.
READ-ONLY: no live writes/auth/signing/relay-publish/admin actions/navigation. Open it from the
title-screen `⛩ PROJECT DASHBOARD` link (`./continuum.html`).
**CSP hardening (v0.2.172):** `renderContinuumPage` now emits a strict `Content-Security-Policy`
`<meta>` (`CONTINUUM_CSP`) — `default-src 'self'`; `object-src`/`base-uri`/`form-action`/
`frame-ancestors` `'none'`; `connect-src 'self'` (same-origin JSON refresh only); `script-src
'self' '<sha256>'` (NO `'unsafe-inline'` script — the one refresh IIFE is hashed via
`CONTINUUM_SCRIPT_SHA256` over `CONTINUUM_REFRESH_SCRIPT`, kept in sync by a `node:crypto` test so
it cannot drift); `style-src 'self' 'unsafe-inline'` (data-driven bar widths only — styles cannot
execute JS). Resolves the prior inline-script WARN; page stays fully static/read-only.
**Engineering health (v0.2.175):** a PURE `buildHealthModel(input)` + frozen `HEALTH_LASTKNOWN`
baseline drive an **Engineering health** `<section>` (cards + 3 SVG rings + the efficiency-loop
note: measure · profile · standardise · automate · modularise · document). It runs at module load
for the curated `CONTINUUM.health` fallback AND in `tools/build-continuum.mjs` with GENERATED
inputs (profile/test-file counts, parser gaps, version, doc-sync). Each metric carries
`kind: 'generated' | 'last-known'` shown as a provenance chip (`.hk-gen`/`.hk-lk`) so a stale
number is obvious; GENERATED = profile sizes/parser gaps/version/doc-sync, LAST-KNOWN = total
tests/timings/bundle/last-green gate. Server-rendered escaped text, NO new `<script>` — CSP hash
unchanged. `continuumDataJSON` carries `health`.

**Milestones (v0.2.176):** a PURE `buildMilestoneModel(input)` + frozen `SEED_MILESTONES` drive a
**Milestones** `<section>`. The 15-hour MVP route is the ONE true ACTIVE milestone — its
`leanRoute` slices ARE its tasks, folded into DERIVED counts (`total`/`done`/`active`/`pending`
from each slice's `state`) + a `donePct` and a directional `progressPct` (`_average` of per-slice
`progress`, labelled an estimate, never conflated with tasks-done) — shown as an ACTIVE-pill card
with a % bar + bullet-list counts, alongside clearly-labelled `SEED_MILESTONES` future cards so the
"total milestones" figure stays HONEST (1 active + N seed). `buildContinuumModel` attaches
`milestones`; `continuumDataJSON` carries it. Grouped card values now render as `<ul class="mini">`
bullet lists via `_cardValueHtml` (` · `-joined → bullets; user preference over dense prose).
Server-rendered escaped text, NO new `<script>` — CSP hash unchanged. Layout follow-up:
**DASHBOARD-LAYOUT-1**.

**Layout / readability pass (v0.2.177, DASHBOARD-LAYOUT-1 first pass):** the renderer's
information hierarchy was tightened. The ACTIVE-milestone headline is PROMOTED above At-a-glance
(order: Active focus → Milestones → At a glance → Engineering health → Tracks → 15-hour route →
Now/Next/Later → Next 12 → Risk); a new `_h2(title,count)` helper emits a `.h2row` heading with an
item-count `.count` chip and every section carries a one-line `<div class="lead">` caption; the
Now/Archive/Done lists moved into ONE `<div class="cols">` reflowing on a responsive auto-fit grid
(`minmax(260px,1fr)`, no hard 3→1 break) with live counts; spacing/typography tightened (wider
1080px `main`, larger section margins, subtle card hover). All server-rendered escaped text, NO new
`<script>`/asset — CSP hash unchanged; DERIVED/GENERATED/LAST-KNOWN/SEED chips stay visible. A
larger visual redesign remains a documented future follow-up.

**Deployment readiness (v0.2.186):** a PURE browser-safe `buildReadinessModel({zoneFallback})` +
`READINESS_BADGE` surface a **Deployment readiness** `<section>` that shows the v0.2.185 `/zone/*`
static-host fallback verdict at a glance. It folds the read-only `checkZoneFallbackReadiness({docs,
dist})` result (passed in — the module does NO fs/network) into a render-ready `{badge,status,
statusLabel,checks,errors,warnings,note}` model with honest states — **READY** (docs ok + dist
checked) / **DOCS READY · BUILD CHECK PENDING** (docs ok, no build yet) / **NOT READY** (a required
doc/dist shape fails) / **NOT CHECKED** (no input) — and a four-row per-check table (SPA fallback
documented, built dist route shape, host fallback = MANUAL, auto-update = MANUAL). It never throws
and each check `state` reuses the existing pill vocabulary (`no-blocker`/`gated`/`manual`/
`deferred`) so `_readinessSection` adds NO new CSS. `tools/build-continuum.mjs` reads the required
docs + walks `dist/` at packaging time (absent → dist check SKIPPED; regression-check [15] is the
authoritative dist check) and feeds the real verdict; with no override a curated NOT-CHECKED model
ships. `continuumDataJSON` carries `readiness`. Server-rendered escaped text, NO new `<script>`/
`data-k` → CSP hash unchanged. `tests/continuum-dashboard.test.js` (+8).

`githubReleaseSource` (LEAN-5, v0.2.157) is the pure GitHub Releases source adapter:
`normalizeRelease`/`selectLatestRelease`/`evaluateFromSource` turn a `releases/latest`
object, a `releases` array, or a manifest into an update verdict; the optional
`fetchLatestRelease` is host-only and requires an injected `fetcher` (no auto-fetch).

`updateStatus` (LEAN-5, v0.2.158) is the pure in-game UPDATE-STATUS panel:
`updateStatusPanel(payload?,opts?)` folds the release source + the inert preview into
one render-ready, display-only view (`{title,badge,surface,step,status,statusLabel,
currentVersion,latestVersion,updateAvailable,prompt,notesPreview,source:{status,kind,
candidates,errors},sourceUrl,lines,readOnly:true,actionable:false}`); defaults to a
deterministic local `SAMPLE_RELEASE_FEED` (no wire), degrades draft/empty/malformed to
UNKNOWN, and exposes NO fetch/install/update/navigate/href/onClick/autoUpdate key.

### INTERNAL (forward-declared, `module:null` — do NOT depend on yet)

`physicsBodies`, `physicsRaycast`, `player`, `identity`.

---

## 2. The four MVP proof surfaces + the loop

The 15-hour proof-of-concept route renders four inert title-screen preview cards,
framed as one **Travel → Market → Score → Update** loop. Each card is fed by a pure
SDK preview module and mirrored read-only on `ToriiDebug.shells`.

| Step | LEAN | Card / SDK namespace | `ToriiDebug.shells` report | Inert invariants |
|---|---|---|---|---|
| 1 · TRAVEL | LEAN-2 | `gatewayPreview` | `gatewayPreview()` | `readOnly:true`, `actionable:false` — never navigates |
| 2 · MARKET | LEAN-3 | `productPreview` | `productPreview()` | `readOnly:true`, `actionable:false` — no checkout/pay/zap |
| 3 · SCORE | LEAN-4 | `leaderboardPreview` | `leaderboardPreview()` | `readOnly:true`, `actionable:false`, `signed:false`, `published:false` |
| 4 · UPDATE | LEAN-5 | `updatePreview` | `updatePreview()` | `readOnly:true`, `actionable:false` — no fetch/install/auto-update |
| (header) | — | `mvpLoop` | `mvpLoop()` | `readOnly:true`, `actionable:false` — content/labelling only |

Underlying view/shell modules behind these previews: `gatewayPortal` (LEAN-2),
`productPanelShell` (LEAN-3), `leaderboardView` (LEAN-4), `updateCheck` (LEAN-5).
The `*Preview` modules are the visible-but-inert presentation layer over them.

As of **v0.2.146** all four previews expose the same `readOnly:true` +
`actionable:false` invariant pair (the gateway preview gained `readOnly` for
symmetry), so a reviewer can assert one consistent shape across every proof surface.

---

## 3. `ToriiDebug.shells.*` reports

Read-only DEBUG reports over the proof surfaces, with safe frozen demo fixtures
(`DEMO_GATEWAY`/`DEMO_PRODUCT`/`DEMO_SCORES`/`DEMO_RELAY_SCORE_EVENTS`/`DEMO_PROFILE_EVENTS`/`DEMO_RELEASE`) so each works
out-of-the-box. They ONLY read the shells' pure return values — no signer, relay,
publish, or navigation. Pass overrides to inspect your own data.

| Call | Returns (shape highlights) |
|---|---|
| `shells.gateway(c?,ctx?,o?)` | gateway portal VIEW summary — `{status,isGateway,armed,destinationLabel,relay,prompt,urlPreview,errors}` |
| `shells.gatewayPreview(c?,ctx?,o?)` | LEAN-2 preview block — `{title,status,statusLabel,armed,destination,relay,intent,urlPreview,badge,lines,readOnly:true,actionable:false}` |
| `shells.product(p?)` | product panel RENDER summary — `{ok,errors,title,lineCount,lines,footer,actionable:false,actionCount:0,readOnly:true}` |
| `shells.productPreview(p?,o?)` | LEAN-3 preview block — `{title,ok,seller,sellerFull,marketplace,badge,lines,readOnly:true,actionable:false,errors}` |
| `shells.leaderboard(s?,o?)` | ranked summary — `{mode,count,skipped,rows,signed:false,published:false}` |
| `shells.leaderboardPreview(s?,o?)` | LEAN-4 preview block — `{title,mode,modeLabel,badge,signed:false,published:false,signer,count,shown,skipped,proof,rows,lines,readOnly:true,actionable:false}` |
| `shells.leaderboardRelayRead(e?,o?)` | **v0.2.160** READ-ONLY leaderboard relay-read PROOF over a deterministic LOCAL sample — `{ok,filter,count,rows,skipped,duplicates,signed:false,published:false,readOnly:true,errors}` (extract→dedupe→rank; no relay I/O) |
| `shells.profileRead(e?,o?)` | **v0.2.161** READ-ONLY identity/profile PROOF over a deterministic LOCAL sample — `{ok,filter,count,profiles,skipped,duplicates,signed:false,published:false,readOnly:true,errors}` (kind:0 parse→sanitise→newest-per-author; https-only inert URLs, no DOM/relay I/O) |
| `shells.consentGate(o?)` | **v0.2.162** READ-ONLY CONSENT-GATE foundation map — `{title,badge,count,writeActions,allowedByDefault,actions:[{action,kind,write,signed,requiresConsent,danger,allowed,blocked,reason,performed:false,summary}],readOnly:true,performed:false}` (reads allowed, writes blocked until an explicit grant; pass `{grants}` to preview; never signs/publishes/acts) |
| `shells.leaderboardSubmit(i?,g?)` | **v0.2.163** READ-ONLY leaderboard SUBMIT INTENT/PREVIEW over a deterministic sample — `{title,badge,action,ok,allowed,blocked,reason,kind,identity,tags,summary,signed:false,published:false,performed:false,readOnly:true,errors}` (inert UNSIGNED kind-30000 draft routed through the consent gate; BLOCKED with no grant, pass a grant to preview allow; never signs/publishes/sends/connects) |
| `shells.gatewayRead(e?)` | **v0.2.164** READ-ONLY gateway DESTINATION-RECORD read proof over a deterministic LOCAL sample — `{title,badge,ok,count,duplicates,filter,gateways,skipped,navigated:false,signed:false,published:false,performed:false,readOnly:true,errors}` (kind-30078 `#t:torii-gateway` filter; extract→sanitise→newest-per-zone; https-only inert URLs + ws/wss relays, no navigation/DOM/relay I/O) |
| `shells.gatewayTravel(input?,grant?)` | **v0.2.165** READ-ONLY gateway TRAVEL CONFIRMATION/INTENT behind the consent gate over `DEMO_TRAVEL_INPUT` — `{title:'GATEWAY TRAVEL INTENT',badge,action,ok,allowed,blocked,reason,destination,summary,navigated:false,performed:false,signed:false,published:false,readOnly:true,errors}` (sanitise destination → `evaluateConsent('gateway:travel',grant)`; BLOCKED with no grant, allowed-but-never-performed with a matching grant; no navigation/sign/publish/send/connect) |
| `shells.consentPrompt(o?)` | **v0.2.166** CONSENT UX VIEW-MODEL preview map — `{title:'CONSENT PROMPT PREVIEW',badge:'CONSENT · PREVIEW · NO ACTION',count,writeActions,allowedByDefault,rows:[{action,headline,actionLabel,cancelLabel,severity,requiresExplicitConsent,allowed,blocked,reason,reasonText,actionable:false}],readOnly:true,actionable:false,performed:false}` (the user-facing prompt copy a future confirm dialog WOULD draw for every action; blocked-by-default for writes, pass `{grants}` to preview allow; never confirms/signs/publishes/navigates) |
| `shells.handoffPlan(input?,grant?,hostContext?)` | **v0.2.167** INERT host TRAVEL HANDOFF PLAN over `DEMO_HANDOFF_INPUT` — `{title:'GATEWAY HANDOFF PLAN',badge:'HANDOFF · DRY-RUN · NO NAVIGATION',action,status,ok,reason,targetZoneId,targetRoute,targetUrl,currentRoute,rollbackRoute,preflight,commands,summary,dryRun:true,navigated:false,worldReloaded:false,performed:false,signed:false,published:false,readOnly:true,errors}` (consumes a `gateway:travel` intent → dry-run handoff/rollback plan; READY only under a matching grant, blocked-by-default; sanitised route/url; future command names are STRINGS only; no navigation/world-reload/sign/publish/send/connect) |
| `shells.handoffExecute(input?,grant?,transport?,opts?)` | **v0.2.168** TRAVEL EXECUTE report over `DEMO_HANDOFF_INPUT` — `{title:'GATEWAY TRAVEL EXECUTE',badge:'TRAVEL · SAME-ORIGIN · HOST-TRANSPORT',action,status,ok,reason,targetRoute,fromRoute,rollbackRoute,steps,rollback,rolledBack,navigated,performed,external:false,worldReloaded:false,signed:false,published:false,network:false,errors}` (plans then runs the executor; with NO transport injected it is a dry-run NO-OP and never navigates the live app; pass a fake `{navigate,snapshot?,rollback?,log?}` to preview a same-origin route change; targetUrl/external never executed; safety flags pinned) |
| `shells.hostTransport(input?,grant?,opts?)` | **v0.2.170** HOST TRANSPORT report over `DEMO_HANDOFF_INPUT` — `{title:'GATEWAY HOST TRANSPORT',badge,transportBadge,action,status,ok,reason,targetRoute,fromRoute,rollbackRoute,hostRoute,pushStateCalls,replaceStateCalls,rollback,rolledBack,navigated,performed,inMemory:true,external:false,worldReloaded:false,signed:false,published:false,network:false,errors}` (plans then drives `executeHandoff` through an in-memory recording host — records `pushState`/`replaceState` calls, never navigates the live app; same-origin only, safety flags pinned) |
| `shells.gatewayActivation(input?,grant?,opts?)` | **v0.2.178** GATEWAY ACTIVATION report over `DEMO_HANDOFF_INPUT` — `{title:'GATEWAY ACTIVATION',badge,action,status,ok,confirmed,live,reason,transportKind,targetRoute,fromRoute,rollbackRoute,hostRoute,pushStateCalls,inMemory:true,navigated,performed,external:false,worldReloaded:false,signed:false,published:false,network:false,errors}` (drives the LIVE-WIRE `activateGatewayHandoff` through an in-memory recording host — defaults `confirmed:true` + a `/zone/` route allowlist, records `pushState`, NEVER navigates the live browser; pass `{confirmed:false}` to see the unconfirmed no-op; same-origin only, safety flags pinned) |
| `shells.gatewayPortalActivation(component?,context?,grant?,opts?)` | **v0.2.180** GATEWAY PORTAL ACTIVATION report over the demo gateway component + `DEMO_PORTAL_CONTEXT` — `{title:'GATEWAY PORTAL ACTIVATION',badge,action,status,ok,confirmed,live,reason,transportKind,zoneId,targetRoute,fromRoute,rollbackRoute,routeAllowlist,hostRoute,pushStateCalls,inMemory,navigated,performed,external:false,worldReloaded:false,signed:false,published:false,network:false,errors}` (bridges an in-world gateway component to `activateGatewayHandoff` through an in-memory recording host — defaults `confirmed:true` + the `['/zone/']` allowlist, maps the component's `target`→`zoneId`, DROPS any external `website`, records `pushState`, NEVER navigates the live browser; pass `{confirmed:false}` for the unconfirmed no-op; same-origin only, safety flags pinned) |
| `shells.portalTrigger(component?,context?,opts?)` | **v0.2.181** GATEWAY PORTAL TRIGGER report driving a `createRecordingHost` boundary through a far→near approach (+ optional `{interact:true}`) — `{title:'GATEWAY PORTAL TRIGGER',badge,promptText,farInRange,nearInRange,armedAfterApproach,pushStateAfterArm,promptLog,interacted,status,navigated,confirmed,live,zoneId,targetRoute,routeAllowlist,pushStateCalls,inMemory:true,external:false,worldReloaded:false,signed:false,published:false,network:false,errors}` (proves proximity ALONE arms+previews but records NO `pushState`; only an explicit `interact` confirms → records the `/zone/<slug>` `pushState`; NEVER navigates the live browser; same-origin only, safety flags pinned) |
| `shells.zoneRoute(path?)` | **v0.2.182** ZONE ROUTE report over `DEMO_ZONE_ROUTE` — `{title:'ZONE ROUTE',badge:'ZONE ROUTE · SAME-ORIGIN · INERT',sample,home:{kind:'home',ok:true},valid:{kind:'zone',ok,slug,zoneId,route,title,notice},rejects:{traversal,percent,protocolRelative,scheme,subPath,malformedSlug,emptySlug}(all 'invalid'),summary,navigated:false,performed:false,network:false,external:false,signed:false,published:false,inMemory:true,errors}` (parses/classifies a same-origin path home/zone/invalid and labels every hostile path INVALID; pure URL interpretation, NEVER navigates/fetches; safety flags pinned) |
| `shells.portalMeshPlan(opts?)` | **v0.2.183** PORTAL MESH PLAN report over `DEMO_PORTAL_MESH_OPTS` — `{title:'PORTAL MESH PLAN',badge:'PORTAL MESH · DISPLAY-ONLY · INERT',ok,anchor,range,ringRadius,ringMatchesRange,count,parts:[{id,kind,role,spin,pulse}],allPartsInert,summary,rendered,navigated:false,performed:false,external:false,signed:false,published:false,actionable:false,reasons}` (pure render-plan for the visible in-world portal marker at the trigger position; outer-ring `ringRadius`===trigger `range`; every part + plan pinned inert; DISPLAY-ONLY, changes nothing in the safety model) |
| `shells.portalMesh()` | **v0.2.183** PORTAL MESH render-state from the browser adapter `portalMesh.js` — frozen `{rendered,count,ok,badge,reasons,anchor?,ringRadius?}` snapshot (build-once behind `_built`, allocation-free scalar tick, dispose/reuse on teardown); inert display, no nav/sign/publish surface (in node/test with no live build it reports `{rendered:false,reasons:['not-built']}`) |
| `shells.zoneLabel(opts?)` | **v0.2.184** ZONE LABEL report over `DEMO_ZONE_LABEL_OPTS` — `{title:'ZONE LABEL',badge:'ZONE LABEL · DISPLAY-ONLY · INERT',prompt,promptGeneric,entered,hostileSanitized,safe,navigated:false,performed:false,external:false,signed:false,published:false,network:false,actionable:false}` (target-aware proximity prompt + post-hop entered notice; both derived from the safe slug via `humanizeZoneSlug`, free-form/hostile input stripped to an `[A-Za-z0-9 -]` allowlist; the `safe` flag proves no markup/dangerous token survives; DISPLAY-ONLY, never navigates/signs/publishes) |
| `shells.updatePreview(r?,o?)` | LEAN-5 preview block — `{title,badge,status,statusLabel,currentVersion,latestVersion,updateAvailable,prompt,source,lines,readOnly:true,actionable:false}` |
| `shells.updateStatus(p?,o?)` | **v0.2.158** LEAN-5 in-game UPDATE-STATUS panel — `{title,badge,surface,step,status,statusLabel,currentVersion,latestVersion,updateAvailable,prompt,source:{status,kind,candidates,errors},sourceUrl,lines,readOnly:true,actionable:false}` (defaults to local sample feed) |
| `shells.mvpLoop(o?)` | loop header block — `{title,badge,flow,note,version,steps,lines,readOnly:true,actionable:false}` |
| `shells.report(inputs?)` | composite of all of the above (each section overridable via `inputs`) |
| `shells.summary(inputs?)` | **v0.2.145** discoverability aggregate (see §4) |
| `shells.diff(a?,b?)` | **v0.2.146** pure diff of two `summary()` outputs, flagging invariant flips that loosen inertness (see §4.1) |
| `shells.surfaceSpecs()` | **v0.2.147** pure in-world proof-surface LAYOUT/SPEC layer — `{badge,anchorZone,count,bounds,specs,allInert,rendered:false,actionable:false}` (see §4.2) |
| `shells.surfaceSpecCheck(map?,specs?)` | **v0.2.148** pure cross-check that each spec's `previewSdk`/`shell` align with the live SDK + shells registries + inert invariants — `{ok,badge,checked,errors,warnings,surfaces}` (see §4.3) |
| `shells.anchorTransforms(specs?)` | **v0.2.149** pure anchor→transform resolution — binds each spec's `anchor` id to a plain transform descriptor (origin/position/offset/size/yawRad) + lists unresolved anchors — `{ok,badge,count,resolved,unresolved}` (see §4.4) |
| `shells.surfaceRender()` | **v0.2.150** render state of the FIRST display-only in-world proof-surface mesh pass — `{rendered,count,ok,badge,reasons,parents}`; `rendered` true only after the inert panels build (both gates pass), else `reasons` carries the failures (see §4.5) |
| `shells.surfaceBindings(opts?)` | **v0.2.151** scene-graph PARENT BINDING — groups the render plan's panels by their `parent` hint, mapping each to the live scene-node name + per-parent display-only group name (`proof-surfaces::<parent>`) the mesh adapter mounts them under — `{ok,badge,group,count,groups,unbound}` (see §4.6) |
| `shells.surfaceGate(opts?)` | **v0.2.152** promotion/regression GATE — folds the spec cross-check + render plan + parent binding into one fail-fast `{ok,gates:{specCheck,renderPlan,parentBinding},counts,reasons}`; the single gate a reviewer/CI asserts before the proof boards build or any preview→live promotion. RUN by `tools/regression-check.mjs` check [12] (see §4.7) |

Other namespaces on `ToriiDebug`: `snapshot()` / `combat.report()` / `physics.report()`
(JSON-serialisable status), `bots`, `player`, `physics`, `world`, `identity`, `fx`.

---

## 4. `ToriiDebug.shells.summary()` — one-call overview (v0.2.145)

`shells.summary()` (pure `shellsSummary()` in `shellReport.js`) returns a compact,
JSON-serialisable map of the four proof surfaces framed by the loop. Every invariant
is **read from the live report output**, so the summary cannot claim an inertness the
underlying shell does not have. Shape:

```js
{
  version,            // === config VERSION
  flow,               // "Travel → Market → Score → Update"
  loop: { key:'mvpLoop', sdk, shell, title, flow, invariants:{readOnly,actionable} },
  surfaces: [         // 4 entries, in loop order
    { key, lean, step, sdk, shell, title, invariants:{ readOnly, actionable, signed?, published? } },
    ...
  ],
  count: 4,
  allInert,           // true iff no surface/loop is actionable and none claim signed/published
  network: false,     // false by construction across every proof surface
  autoUpdate: false,  // false by construction
}
```

`allInert` is the single boolean a reviewer (human or AI) can assert to confirm the
proof surfaces remain display-only. Every surface carries `readOnly` + `actionable`
(v0.2.146 symmetry); the leaderboard adds `signed` + `published`.

---

## 4.1. `ToriiDebug.shells.diff(a, b)` — promotion review helper (v0.2.146)

`shells.diff(a, b)` (pure `shellsDiff()` in `shellReport.js`) compares two
`summary()` outputs — `a` = before/preview, `b` = after/promoted — and classifies
each invariant flip so a preview→live promotion can be reviewed mechanically. It
performs NO network/actions/DOM/THREE; it only compares two already-computed
summaries. Shape:

```js
{
  changed,                 // any flip at all
  safe,                    // true iff NO flip loosens inertness
  fromVersion, toVersion,
  flips: [                 // every difference found
    { scope:'summary',  key, from, to, loosens },                 // allInert/network/autoUpdate
    { scope:'surface',  key, invariant, from, to, loosens },      // per-surface invariant
    { scope:'surface',  key, change:'added'|'removed', loosens:false },
  ],
  loosened,                // subset of flips where loosens===true — the review checklist
}
```

A flip **loosens** inertness when it moves an invariant to its unsafe value
(`actionable→true`, `readOnly→false`, `signed→true`, `published→true`,
`allInert→false`, `network→true`, `autoUpdate→true`). `safe===true` means the diff
only changed display/labels or *tightened* inertness — exactly the property a
reviewer wants before approving a promotion. Untracked keys never count as loosening.

---

## 4.2. `ToriiDebug.shells.surfaceSpecs()` — in-world layout/spec layer (v0.2.147)

`shells.surfaceSpecs()` (pure `proofSurfaceLayout()` in
`engine/world/proofSurfaceSpecs.js`) returns the spec/contract layer for the FUTURE
in-world proof meshes — placement data for the four MVP proof surfaces as PLAIN data
only. It builds NO Three.js objects, touches NO DOM/renderer, and integrates NO
gameplay: `position`/`size` are `{x,y,z}`/`{width,height,depth}` plain objects and
facing is a plain `yawRad` number, so the module stays node-testable. Shape:

```js
{
  badge,               // "SPEC · INERT · LAYOUT-ONLY"
  anchorZone: 'nap-zone',
  count: 4,
  bounds: { minX, maxX, minZ, maxZ },   // all within the NAP zone (x in [NAP_X, NAP_FAR_X])
  specs: [             // PROOF_SURFACE_SPECS — 4 frozen specs in loop order
    { id, step, lean, title, kind, previewSdk, shell, anchor,
      position:{x,y,z}, size:{width,height,depth}, yawRad,
      invariants:{ readOnly:true, actionable:false, signed?, published? } },
    ...
  ],
  allInert,            // true iff no spec is actionable and none claim signed/published
  rendered: false,     // nothing is in-world yet — spec/contract layer only
  actionable: false,
}
```

The four specs are `gateway-portal-panel` (TRAVEL/LEAN-2), `product-stall-panel`
(MARKET/LEAN-3), `leaderboard-board` (SCORE/LEAN-4), `update-prompt-board`
(UPDATE/LEAN-5). `getProofSurfaceSpec(id)` returns one spec or null. This is the
contract a future mesh pass binds against; `rendered:false`/`allInert` are the gates
a reviewer asserts to confirm nothing has gone live yet.

---

## 4.3. `ToriiDebug.shells.surfaceSpecCheck()` — spec↔registry cross-check (v0.2.148)

`shells.surfaceSpecCheck(map?, specs?)` (pure `checkProofSurfaceSpecs()` in
`engine/debug/proofSurfaceCheck.js`) verifies the proof-surface specs stay ALIGNED
with the live registries they claim to feed from — the guard you run BEFORE the
future mesh pass binds a mesh to a spec. It performs NO render/network/DOM; it only
reads static `SDK_SURFACE` metadata + the deterministic demo output of
`buildShellReport()`. For each spec it checks:

- `previewSdk` names a real SDK **experimental** namespace (unknown → error;
  known-but-non-experimental → warning),
- `shell` names a real `ToriiDebug.shells` report (a `buildShellReport()` key),
- the inert invariants hold (`readOnly:true`/`actionable:false`, never
  `signed`/`published` true), and
- no live-action key (`fetch`/`navigate`/`href`/`sign`/`publish`/`checkout`/
  `onClick`/`mesh`/`geometry`/…) has crept onto the spec.

Shape:

```js
{
  badge: 'SPEC-CHECK · READ-ONLY · NO RENDER',
  checked,                 // number of specs checked
  ok,                      // true iff errors.length === 0
  errors,                  // alignment/invariant violations (fail ok)
  warnings,                // non-fatal (e.g. a non-experimental SDK reference)
  surfaces: [ { id, previewSdk, shell, sdkOk, shellOk, inert }, ... ],
}
```

Pass `{ sdk, shells }` (each a Set or array of names) to check against your own
registries instead of the live defaults; pass `specs` to check a candidate spec set.
`ok===true` is the single boolean a reviewer asserts to confirm the spec layer is
wired correctly before promotion.

---

## 4.4. `ToriiDebug.shells.anchorTransforms()` — anchor→transform contract (v0.2.149)

`shells.anchorTransforms(specs?)` (pure `resolveAllAnchors()` in
`engine/world/anchorTransforms.js`) is the single source of truth for what each
proof-surface `anchor` id MEANS in world space, so the future mesh pass can resolve
placement without re-deriving coordinates. It builds NO Three.js objects, touches NO
DOM/renderer, integrates NO gameplay: every coordinate is a plain `{x,y,z}` object /
plain number. The anchor registry (`PROOF_SURFACE_ANCHORS`, keyed by the four anchor
ids) maps each anchor to a ground `origin` (y:0), a `parent` hint, and its NAP `zone`.
`resolveAnchorTransform(spec)` binds one spec to its anchor; `resolveAllAnchors(specs)`
resolves the set. Shape:

```js
{
  badge: 'ANCHOR · PLAIN-TRANSFORM · NO RENDER',
  count,                   // number of specs considered
  ok,                      // true iff every spec's anchor resolved (unresolved empty)
  resolved: [              // one descriptor per resolvable spec
    { badge, surfaceId, anchor, parent, zone,
      origin:{x,y,z},      // anchor ground point (y:0)
      position:{x,y,z},    // surface world position (from the spec)
      offset:{x,y,z},      // position − origin (local offset to apply at the anchor)
      size:{width,height,depth}, yawRad,
      rendered:false, actionable:false },
    ...
  ],
  unresolved: [ { surfaceId, anchor }, ... ],   // specs pointing at an unknown anchor
  rendered: false,
  actionable: false,
}
```

The four anchors are `torii-gate-threshold` (parent `torii-gate`),
`nap-zone-north-stall`, `nap-zone-far-centre`, and `nap-zone-south-board` (parent
`nap-zone-floor`). `getAnchor(id)` returns one anchor or null. The invariant
`origin + offset === position` lets a mesh pass parent to the anchor and apply a
local offset; `ok===true` confirms every spec resolves before any mesh binds.

---

## 4.5. `ToriiDebug.shells.surfaceRender()` — first display-only mesh pass (v0.2.150)

`shells.surfaceRender()` reports the render state of the FIRST in-world proof-surface
mesh pass. It is split into two modules:

- **`engine/world/proofSurfaceRenderPlan.js`** — PURE, node-safe. `buildProofSurfaceRenderPlan(opts?)`
  runs the live `resolveAllAnchors()` + `checkProofSurfaceSpecs()` gates (either can be
  injected via `opts.anchors`/`opts.check`) and turns the four specs into a plain-data
  RENDER PLAN: `{badge,ok,gates:{anchorsOk,specCheckOk},count,panels,reasons,rendered:false,actionable:false}`.
  Each panel carries `{id,label,sublabel,kind,anchor,position,size,yawRad,color,readOnly:true,actionable:false}`.
  NO Three/DOM/renderer — fully deterministic and tested.
- **`engine/world/proofSurfaceMeshes.js`** — browser-only adapter. `buildProofSurfaceMeshes(scene,opts?)`
  consumes the plan and, ONLY when `plan.ok`, builds inert panel meshes (a coloured
  `BoxGeometry` board + a `CanvasTexture` label plate, same canvas-text pattern as the
  bitcoin sun) ONCE during scene setup (`arena.js` `_buildNapZone`). Idempotent via a
  `rendered` guard; NO per-frame/hot-path allocation. `proofSurfaceRenderState()`
  mirrors the result.

Shape of `surfaceRender()`:

```js
{
  rendered,   // true only after the inert panels were built (both gates passed)
  count,      // number of panels rendered (0 when gated shut)
  ok,         // === rendered
  badge: 'RENDER-PLAN · DISPLAY-ONLY · INERT',
  reasons,    // [] when ok; else gate failures ('anchors-unresolved'/'spec-check-failed'/'no-scene'/'not-built')
}
```

DISPLAY-ONLY and INERT: no click handlers, raycast/interaction, navigation, payments,
Nostr actions, live data, or external fetch. The panels are visual markers only.

---

## 4.6. `ToriiDebug.shells.surfaceBindings()` — scene-graph parent binding (v0.2.151)

`shells.surfaceBindings(opts?)` (pure `resolveParentBindings()` in
`engine/world/proofSurfaceParentBinding.js`) makes the proof-surface board MOUNTING
explicit and discoverable. Each anchor carries a `parent` hint (`torii-gate` /
`nap-zone-floor`); this groups the render plan's panels by that hint and maps each to
the live scene-node name + the per-parent display-only group name the adapter mounts
the boards under. Shape:

```js
{
  badge: 'PARENT-BINDING · SCENE-GRAPH · NO RENDER',
  group: 'proof-surfaces',          // root display-only group name
  count,                            // panels considered
  ok,                              // true iff every panel bound + ≥1 group formed
  groups: [                        // one per distinct parent, in plan order
    { parent: 'torii-gate',
      parentNode: 'torii-gate',                 // live scene-node name (scene.getObjectByName)
      groupName: 'proof-surfaces::torii-gate',  // per-parent subgroup the adapter creates
      panelIds: ['gateway-portal-panel'] },
    { parent: 'nap-zone-floor', parentNode: 'nap-zone-floor',
      groupName: 'proof-surfaces::nap-zone-floor',
      panelIds: ['product-stall-panel','leaderboard-board','update-prompt-board'] },
  ],
  unbound: [],                     // panel ids whose parent couldn't be determined
  rendered: false, actionable: false,
}
```

The mesh adapter (`proofSurfaceMeshes.js`) builds one named subgroup per parent under the
`proof-surfaces` root and adds each board to its parent's subgroup. **Boards keep their
WORLD positions** (subgroups sit at the origin) — this is a structural/discoverability
change, not a placement or visual change, and adds NO behaviour (still display-only/inert).
`arena.js` `.name`s the live `nap-zone-floor` + `torii-gate` nodes so they resolve via
`scene.getObjectByName`. PURE/node-safe — NO THREE/DOM; builds and parents nothing.

---

## 4.7. `ToriiDebug.shells.surfaceGate()` — promotion/regression gate (v0.2.152)

`shells.surfaceGate(opts?)` (pure `proofSurfaceGate()` in
`engine/debug/proofSurfaceGate.js`) is the single fail-fast gate that answers "are the
display-only proof boards + their bindings safe and complete?" It folds the three pure
layers that must ALL hold before the in-world boards may be built — and, in the future,
before any preview→live promotion:

1. spec↔registry cross-check — `checkProofSurfaceSpecs().ok` (§4.3)
2. render plan — `buildProofSurfaceRenderPlan().ok` (§4.5)
3. scene-graph parent binding — `resolveParentBindings(plan).ok` (§4.6)

Shape:

```js
{
  badge: 'PROOF-GATE · READ-ONLY · PROMOTION',
  ok,                              // true iff all three sub-gates pass
  gates: { specCheck, renderPlan, parentBinding },  // per-layer booleans
  counts: { panels, groups, bound, unbound },
  reasons: [                       // concrete failures (empty iff ok), e.g.
    // 'render-plan-not-ok', 'render-plan: anchors-unresolved',
    // 'parent-binding-not-ok', 'parent-binding: unbound <id>'
  ],
  rendered: false, actionable: false,
}
```

Each input (`check` / `anchors` / `plan` / `binding`) is INJECTABLE, so a test can drive
a deliberately-broken layer and prove the gate catches it (`tests/proof-surface-gate.test.js`).
`tools/regression-check.mjs` **check [12]** RUNS this gate (`await import` of the pure,
THREE/DOM-free module) and fails the build with the gate's own `reasons` if any layer is
broken — so a broken board or binding can never reach the browser or a promotion unnoticed.
PURE/node-safe — composes plain data only; renders and acts on nothing.

---

## 5. Where the tests live

| Surface | Test file |
|---|---|
| SDK entrypoint (`SDK_SURFACE`, tiers, re-exports) | `tests/sdk.test.js` |
| `gatewayPreview` | `tests/gateway-preview.test.js` |
| `productPreview` | `tests/product-preview.test.js` |
| `leaderboardPreview` | `tests/leaderboard-preview.test.js` |
| `updatePreview` | `tests/update-preview.test.js` |
| `updateStatus` | `tests/update-status.test.js` |
| `relayRead` | `tests/relay-read.test.js` |
| `leaderboardRelayRead` | `tests/leaderboard-relay-read.test.js` |
| `profileRead` | `tests/profile-read.test.js` |
| `consentGate` | `tests/consent-gate.test.js` |
| `consentView` | `tests/consent-view.test.js` |
| `submitIntent` | `tests/leaderboard-submit-intent.test.js` |
| `gatewayRead` | `tests/gateway-read.test.js` |
| `travelConfirm` | `tests/gateway-travel-confirm.test.js` |
| `handoffPlan` | `tests/handoff-plan.test.js` |
| `handoffExecute` | `tests/handoff-execute.test.js` |
| `hostTransport` | `tests/host-transport.test.js` |
| `mvpLoop` | `tests/mvp-loop.test.js` |
| `ToriiDebug.shells.*` reports + `summary()` | `tests/shell-report.test.js` |
| `proofSurfaceSpecs` / `shells.surfaceSpecs()` | `tests/proof-surface-specs.test.js` |
| `shells.surfaceSpecCheck()` (spec↔registry cross-check) | `tests/proof-surface-check.test.js` |
| `anchorTransforms` / `shells.anchorTransforms()` | `tests/anchor-transforms.test.js` |
| `proofSurfaceRenderPlan` (pure plan) | `tests/proof-surface-render-plan.test.js` |
| `shells.surfaceRender()` adapter guards | `tests/proof-surface-meshes.test.js` |
| `proofSurfaceParentBinding` / `shells.surfaceBindings()` | `tests/proof-surface-parent-binding.test.js` |
| `proofSurfaceGate` / `shells.surfaceGate()` (regression check [12]) | `tests/proof-surface-gate.test.js` |
| underlying view/shell modules | `tests/gateway-portal.test.js`, `tests/product-panel-shell.test.js`, `tests/leaderboard-view.test.js`, `tests/update-check.test.js` |
| `tools/bundleSizes.mjs` (bundle-size advisory, regression check [13] / `npm run bundle:report`) | `tests/bundle-sizes.test.js` |
| `tools/docConsistency.mjs` (docs/status consistency guard, regression check [14]) | `tests/doc-consistency.test.js` |
| `tools/handoffStatus.mjs` (AI-handoff status snapshot, `npm run handoff:status`) | `tests/handoff-status.test.js` |
| `tools/releaseReadiness.mjs` (PURE release-readiness aggregator, v0.2.187) + `tools/release-readiness.mjs` CLI (`npm run release:status`) — one concise ship verdict folding version sync / test-profile counts / regression-gate count / bundle advisory / `/zone/*` fallback / docs consistency / latest reports | `tests/release-readiness.test.js` |
| `tools/testProfiles.mjs` (PURE test-profile registry, v0.2.173) + `tools/test-profile.mjs` CLI (`npm run test:fast` ~5 files / `test:foundation` ~16 files) | `tests/test-profiles.test.js` |

Run all with `npm test` (Vitest, node env). `npm run check` separately guards the
scaffold + version markers statically. For tight inner loops use the **test
profiles** (v0.2.173): `npm run test:fast` (5 core pure files) or
`npm run test:foundation` (16 pure/guard files) — curated, deterministic, no
git-diff heuristics. Every public deploy/publish still requires `npm run test:release`
(full Vitest + `check` + `bundle:report` + `handoff:status`) or equivalent full parent
verification.

---

## 6. How to add a new proof card (or promote preview → live)

### Add a new inert preview card (the safe, established pattern)

1. **Pure module** under `engine/<area>/<name>Preview.js` — export a `*Block(...)`
   formatter returning `{ label, value }` rows + a `*_BADGE` constant. Pin
   `actionable:false` (and `readOnly:true`; `signed:false`/`published:false` if it
   models a transmit). Import only pure deps (config + sibling pure modules) so it
   stays node-testable. **No** THREE/Rapier/DOM, fetch, navigation, or signing.
2. **SDK** — add `export * as <name>` in `src/sdk/index.js` and a `SDK_SURFACE`
   entry at the `EXPERIMENTAL` tier (`tests/sdk.test.js` validates it automatically).
3. **Debug report** — add a `<name>Report(...)` in `shellReport.js` (reads the
   block's pure output, re-pins the inert invariants), add it to `buildShellReport`,
   and surface `shells.<name>(...)` in `toriiDebug.js`. If it is a proof card, add it
   to the `surfaces[]` in `shellsSummary()` so `summary()` and `allInert` cover it.
4. **Render** — in `main.js`, write the rows into the card via `textContent` ONLY
   (no `innerHTML`); add the card markup + CSS in `index.html`.
5. **Test** — add `tests/<name>.test.js` asserting the inert invariants and that no
   live-action keys (`fetch`/`navigate`/`sign`/`publish`/`checkout`/`onClick`) leak.
6. **Docs** — update this index (§2/§3/§5), `CODE_INDEX.md`, `progress.md`, `todo.md`.
7. **Bump the version** and run `npm run build && npm run check && npm test`.

### Promote a preview to a live surface

A "live" surface performs a real side effect (a read-only GitHub fetch, NIP-07
signing, relay publish, in-world navigation). These are **deferred host steps** and
require explicit sign-off — they are NOT safe-slice work. When authorised:

- Keep the pure preview module inert; build the live action as a SEPARATE, guarded
  module (the preview stays the display layer).
- Network reads need a CSP `connect-src` entry and live in the host layer, not the
  pure helper (see `UPDATE_CHECK.md` §3, `VPS_INSTALL.md` §10).
- Signing/publish must go through an injected signer/publisher with explicit user
  confirmation (see `leaderboardPublisher`, SEC-1).
- Flip the relevant invariant deliberately and update `shellsSummary()` + its tests
  so `allInert` reflects reality. Never silently leave `allInert:true` claiming
  inertness a live path has removed.
- Use `shells.diff(before, after)` to review the promotion: its `loosened[]` list is
  the exact set of inertness-reducing flips that need sign-off. A promotion whose
  diff is `safe:true` did not actually loosen anything (likely a no-op or a labelling
  change); a real promotion should show the intended flips in `loosened[]` and
  nothing more.
