# ADR-0033: Ema Rack Renamed "emagake" (Corrected Romanization)

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** chiefmonkey
- **Related:** ADR-0025 (Kami Mode), ADR-0026 (spatial marketplace), ADR-0028
  (floating panels), ADR-0029 (state machine), ADR-0030 (visibility),
  ADR-0031 (hotkey), `src/engine/kami/emagakePanel.js`, `src/engine/kami/kamiMode.js`

## Context

The rack where Kami Mode's ema notes hang was named "emakake" throughout
the codebase (DOM IDs, a module file, exported function names, CSS,
tests, and five prior ADRs). The owner researched the Japanese term and
found most sources spell it **emagake**, and asked for confirmation
before any change.

Verified against multiple independent Japanese-culture sources
([gogonihon.com](https://gogonihon.com/en/blog/ema-in-japan/),
[omikujijapan.com](https://omikujijapan.com/en/journal/ema-wishes-on-wood)):
the rack is 絵馬掛け, romanized **emagake**. This is a standard Japanese
sound change called rendaku (連濁) — when 掛け (*kake*, "hanging/rack")
is compounded onto a preceding word, the leading *k* voices to *g*. The
same pattern appears elsewhere in Japanese compounding (e.g. 手 *te* +
紙 *kami* → 手紙 *tegami*). "Emakake" has no attested currency as an
alternate spelling in the sources checked — it reads as a plausible but
incorrect un-voiced guess, exactly the kind of error a Japanese-literate
player would notice immediately.

This is spelled correctly ~145 times across DOM element IDs
(`#emakake`, `#emakake-body`, `#emakake-count`, `#emakake-empty`,
`#emakake-header`), a module file (`emakakePanel.js`), exported names
(`renderEmakake`, `showEmakake`, `hideEmakake`), CSS, tests, tracking
docs, and six prior ADRs (0025, 0026, 0028, 0029, 0030, 0031) — all with
the same incorrect spelling.

## Decision

Rename every occurrence of "emakake" to "emagake" in every place a
player or a Japanese-literate reader could see or read it: DOM IDs, CSS
selectors, the module file (`emakakePanel.js` → `emagakePanel.js`, via
`git mv` to preserve file history), exported function/variable names,
test files, and the three living tracking docs (`torii-quest-todo.md`,
`torii-quest-progress.md`, `torii-quest-handoff.md`).

**Prior ADRs are not rewritten.** Decision records are a historical log
of what was actually shipped and why, including the mistakes made along
the way — silently editing their body text would misrepresent what the
codebase looked like at the time and erase the trail. Instead, each of
ADR-0025, 0026, 0028, 0029, 0030, and 0031 gets a short "Spelling
correction (ADR-0033)" section appended at the end, pointing to this
ADR. Their original prose keeps the old spelling.

This is a rename only — zero behavior, layout, or protocol change. No
wire message, CSS visual result, or test assertion changes meaning,
only names.

## Consequences

- **Enables:** the in-game copy and codebase no longer contain a visible
  spelling error a Japanese-reading player could notice; future
  contributors copy the correct term from the start.
- **Forecloses:** nothing — this is additive correctness, not a design
  change.
- **Trade-offs:** touches ~20 files in one commit purely for a rename,
  which is a larger diff than the behavior warrants; judged worth it
  because a half-renamed codebase (some IDs correct, some not) would be
  strictly worse than either the old or new spelling used consistently.
- **Enforcement:** none needed beyond this ADR and the appended
  footnotes on the affected historical ADRs — there is no regression
  risk (the string doesn't recur without a contributor typing the old
  spelling from unfamiliarity, which the corrected code now guards
  against by example).

## Alternatives considered

- **Leave "emakake" as an established internal name, only fix
  user-visible copy.** Rejected by the owner — DOM IDs and file names
  are exactly the kind of thing a future contributor (human or AI) will
  copy verbatim from existing code, so a partial fix would keep
  reintroducing the error.
- **Rewrite the prose of the six affected historical ADRs in place.**
  Rejected — ADRs are decision records, not living documentation; the
  standing project rule is ADRs capture what was decided and why at the
  time, not a rolling account restated with hindsight.

## Notes

Confirmed via [gogonihon.com](https://gogonihon.com/en/blog/ema-in-japan/)
("the ema is hung on a rack called *emagake* (絵馬掛け)") and
[omikujijapan.com](https://omikujijapan.com/en/journal/ema-wishes-on-wood)
("Hanging: Tie it to the designated rack (`Ema-kake`)" — same
compound, hyphenated). No source surveyed used "emakake."
