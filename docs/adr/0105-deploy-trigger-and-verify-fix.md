# ADR-0105: Fix silent auto-deploy gap — tag-release tags never fired deploy-on-tag

- **Status:** Accepted
- **Version target:** v0.2.747-alpha
- **Depends on:** [ADR-0101](0101-auto-deploy-on-tag.md) (original auto-deploy on tag push).
- **Related:** none.

## Context

On 2026-09-02, PR #114 (relay-coverage fix) merged to main. `tag-release.yml`
ran, computed `v0.2.746-alpha` from `package.json`, and pushed the tag to
origin — its own log reported success, and `git tag -l` / the GitHub Releases
UI showed the tag present at the correct commit. Nothing looked wrong.

But `deploy-on-tag.yml` (triggered by `on: push: tags: v*-alpha`) never ran.
Production silently stayed on the previous release (`v0.2.745-alpha`) for
roughly 2.5 hours with no error surfaced anywhere — not in Actions, not in
the tag state, not in any of our version markers. The gap was only found
because a second, independent PR ship cross-checked `git tag -l` against
what was actually live on `chiefmonkey.art`.

**Root cause:** `tag-release.yml`'s checkout + push steps use the default
`GITHUB_TOKEN` (no PAT configured). GitHub Actions has a documented
anti-recursion rule: a push (or tag push) made by a workflow run using the
built-in `GITHUB_TOKEN` does **not** trigger other workflows' `on: push`
events. This is a security default to prevent runaway self-triggering
workflow chains, not a bug in GitHub — but it means our auto-deploy pipeline
had a silent hole for every tag created by CI, which is the common case
(every merge to main). The pipeline only worked when a human (or an
agent session using its own token) pushed the tag manually.

**Secondary bug found during recovery:** even a manually-forced deploy of
`v0.2.746-alpha` was reported as FAILED by the workflow's own
"Verify live version matches tag" step, despite the VPS-side install log
showing a clean success. The verification step's `grep -oE
'v0\.2\.[0-9]+-alpha'` matches the page **in document order**, and
`index.html` has accumulated many changelog-style code comments referencing
old version numbers (e.g. `/* v0.2.745-alpha: moved button */`) near the top
of the file — those matched before the real `<div id="ver">` footer label
further down, so the gate compared against a stale string and failed a
deploy that had, in fact, already succeeded.

## Decision

Two independent fixes, both in `deploy-on-tag.yml`, no new secrets required:

1. **Add a second trigger:** `workflow_run: workflows: ['tag-release'],
   types: [completed]`. `workflow_run` events are not subject to the
   GITHUB_TOKEN anti-recursion rule — they fire based on workflow completion,
   not on the token that authored the underlying push. When triggered this
   way, the tag name isn't available on the event payload, so a new
   "Resolve tag to deploy" step reads `package.json` at the completed run's
   `head_sha` via the GitHub API and reconstructs the tag name
   (`v<version>`) rather than trusting a push ref that never arrives. The
   original `push: tags:` trigger is kept as-is (belt and braces) for the
   case where a human/PAT push does fire normally — the job runs from the
   resolved tag either way, so double-firing is a harmless idempotent
   re-deploy of the same version, not a bug.
2. **Scope the live-version-poll to the actual label:** grep specifically
   `<div id="ver">v0\.2\.[0-9]+-alpha`, not a bare page-wide pattern. This
   is the one DOM location that always reflects the deployed build, never a
   historical comment.

**Alternative considered — add a PAT secret:** would also fix (1) cleanly
(a PAT-authored push does trigger downstream workflows normally) and is
arguably simpler. Not used here because it requires the repo owner to mint
and store a new secret outside of what this session can do unattended; the
`workflow_run` approach needs no new credential and ships in the same PR
that already fixes the verification bug.

## Consequences

- Every tag `tag-release` creates now reliably triggers a real deploy
  attempt, closing the exact silent-gap failure mode from 2026-09-02.
- The live-version gate now measures what it always meant to measure,
  removing a source of false-negative "deploy failed" reports when the
  deploy in fact succeeded.
- `workflow_run`-triggered runs check out at the workflow's default
  branch context, not literally the tag ref, but the "Resolve tag to deploy"
  step reads `package.json` at the exact `head_sha` from the completed run,
  so the resolved tag always matches the commit that was actually tagged.
- If a PAT secret is added later for other reasons, this trigger can be
  simplified back to a single `push: tags:` listener — not required now.

## Verification

- `npx vitest run` — 3772+/3772+ green (no runtime code touched, workflow
  YAML only; no new unit tests apply to CI workflow files).
- `npm run check` — 21/21 gates green.
- Manual: next tag `tag-release` creates on a future merge should show a
  corresponding `deploy-on-tag` run in Actions without any manual re-tag.

## Follow-up (v0.2.748-alpha)

The `workflow_run` trigger fix above shipped in v0.2.747-alpha and worked
exactly as designed on the very next merge: `tag-release` auto-created
`v0.2.747-alpha` with `GITHUB_TOKEN`, and the new `workflow_run` listener
correctly fired `deploy-on-tag` anyway — proving the anti-recursion fix
itself was sound. But the "Resolve tag to deploy" step's version-parsing
line failed: `node -p "require('/dev/stdin').version"` piped through
`base64 -d` does not reliably hand Node a readable stream in this runner
shape (observed `base64: write error: Broken pipe` and Node exiting before
consuming stdin), so the step errored out and no deploy occurred for
v0.2.747-alpha. Fixed by dropping Node entirely and parsing the decoded
JSON with `jq -r '.version'` (already used one line earlier for `--jq
'.content'`, so no new dependency) into a `VERSION` variable, then building
`TAG="v${VERSION}"`. Verified locally against the real `package.json`
before shipping. v0.2.747-alpha was never live-served from this pipeline
path (it deployed later, manually, alongside this fix) — no user-facing
regression, caught same-night.
</content>
