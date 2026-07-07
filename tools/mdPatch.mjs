// tools/mdPatch.mjs — a small repo-local markdown patch tool (mdPatch-2).
//
// Lets an assistant (or a human) make SAFE, narrow edits to the active
// source-of-truth task/progress/handoff docs without manual copy-editing and
// without arbitrary file-write access:
//   - torii-quest-todo.md             (Torii Quest active task source of truth)
//   - torii-continuum-todo.md         (Torii Continuum active task source of truth)
//   - torii-quest-progress.md         (curated progress dashboard)
//   - torii-quest-handoff.md          (curated contributor/agent handoff — APPEND-ONLY)
//
// Allowed actions (only these mutate; per-file capability map below):
//   - append a bullet under a heading       (`append`)
//   - replace a named section's body        (`replace`)
//   - append a timestamped live note        (`note`)
//
// Safety rules (enforced by construction):
//   - REJECT any file that is not in the whitelist (basename match).
//   - REJECT path traversal: only a bare basename is accepted — no `/`, no `\`,
//     no `..`, no absolute path, no percent-encoding tricks. A second
//     `relative(root, abs)` confinement check is applied as belt-and-suspenders.
//   - WRITE A `.bak` BACKUP before every real edit (copy of the current bytes).
//   - PRESERVE all untouched markdown exactly: the transforms are string-surgery
//     over `split('\n')` (which round-trips the original bytes) and only insert
//     or replace the targeted heading's body; every other line is byte-identical.
//   - NO NETWORK: no http/https/net/dns/fetch imports — this file never reaches
//     the network. Read-only `list` only reads the whitelisted file.
//   - NO ARBITRARY FILE WRITE: the only paths ever written are the resolved
//     whitelisted target and its sibling `.bak`; nothing else.
//
// Read-only for everything else (never editable here): NOSTR_ARENA_MASTER_TODO.md,
// NEXT_ACTION_STATE.json, generated reports / release artifacts, and any other
// file. Touching those needs a different, explicitly-approved tool.
//
// Per-file capability map (MD_PATCH_CAPABILITIES): torii-quest-handoff.md is the curated
// source of truth, so it is APPEND-ONLY (append / note / list) — `replace` is
// rejected to stop a blind section-swap clobbering handoff content. The two
// todos, torii-quest-todo.md, and torii-quest-progress.md allow append / replace / note / list.
//
// Pure transform helpers (resolveTarget / findSection / appendBulletUnderHeading /
// replaceNamedSection / appendNote / listHeadings / capabilityFor) are exported
// and unit-tested by tests/md-patch.*.test.js; the CLI entry at the bottom of this
// file does the fs I/O (read → backup → write) behind `--dry-run` and exit codes.
//
// Run:  npm run md:patch -- <action> <file> ...
//       node tools/mdPatch.mjs append  torii-quest-todo.md "Active MVP tasks" "a new bullet"
//       node tools/mdPatch.mjs replace torii-quest-todo.md "Scope" --stdin < body.txt
//       node tools/mdPatch.mjs note    torii-quest-progress.md "shipped v0.2.259 — md pipeline"
//       node tools/mdPatch.mjs list   torii-quest-todo.md
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── Schema / badge ───────────────────────────────────────────────────────────
export const MD_PATCH_VERSION = 2;
export const MD_PATCH_BADGE = 'MDPATCH · WHITELIST · SAME-REPO · NO-NETWORK';

// The ONLY files this tool may edit (bare basenames; matched after normalisation).
export const MD_PATCH_WHITELIST = Object.freeze([
  'torii-quest-todo.md',
  'torii-continuum-todo.md',
  'torii-quest-progress.md',
  'torii-quest-handoff.md',
]);

// Files that must NEVER be editable by this tool (documented, not relied on for
// safety — the whitelist is the enforcement; this list is for clarity/reporting).
export const MD_PATCH_READ_ONLY = Object.freeze([
  'NOSTR_ARENA_MASTER_TODO.md',
  'NEXT_ACTION_STATE.json',
]);

// Per-file allowed actions. torii-quest-handoff.md is the curated source of truth, so it is
// APPEND-ONLY (no `replace`) — a blind section-swap there could clobber handoff
// content. Every other whitelisted file allows the full set.
const FULL = Object.freeze(['append', 'replace', 'note', 'list']);
const APPEND_ONLY = Object.freeze(['append', 'note', 'list']);
export const MD_PATCH_CAPABILITIES = Object.freeze({
  'torii-quest-todo.md': FULL,
  'torii-continuum-todo.md': FULL,
  'torii-quest-progress.md': FULL,
  'torii-quest-handoff.md': APPEND_ONLY,
});

// Default heading for the `note` action per file (the natural "on the fly" live
// update target). Overridable via --heading on the CLI. Verified against the
// real docs; if a heading is renamed, the note action reports heading-not-found.
export const MD_PATCH_NOTE_HEADING = Object.freeze({
  'torii-quest-todo.md': 'Active MVP tasks',
  'torii-continuum-todo.md': 'Active tasks',
  'torii-quest-progress.md': 'Active now',
  'torii-quest-handoff.md': '8. Active issues / open edges',
});

// capabilityFor(file) → the frozen action list for that file, or [] if not
// whitelisted. Pure; never throws.
export function capabilityFor(file) {
  if (typeof file !== 'string') return [];
  const caps = MD_PATCH_CAPABILITIES[file.trim()];
  return caps ? [...caps] : [];
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

// isBlank(line) → true for empty / whitespace-only lines.
function isBlank(line) {
  return typeof line === 'string' && line.trim() === '';
}

// HEADING_RE — an ATX heading line: 1–6 `#`, a space, then text (trailing `#`
// close-sequence + whitespace tolerated). Setext (`Heading\n====`) is NOT
// supported; the repo's task docs use ATX only.
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

// headingLevel(line) → 1..6, or 0 if the line is not an ATX heading.
export function headingLevel(line) {
  const m = typeof line === 'string' ? line.match(HEADING_RE) : null;
  return m ? m[1].length : 0;
}

// headingText(line) → the trimmed heading text, or '' for a non-heading line.
export function headingText(line) {
  const m = typeof line === 'string' ? line.match(HEADING_RE) : null;
  return m ? m[2].trim() : '';
}

// findSection(markdown, heading) → { ok, level?, headingIndex?, bodyEnd?, error? }.
//
// Locates the FIRST ATX heading whose text EXACTLY equals `heading`
// (case-sensitive). The section body runs from the line AFTER the heading up to
// (but excluding) the next heading of level <= this heading's level, or EOF.
// Pure string math over `split('\n')` (which round-trips the original bytes).
// Never throws; returns a result object.
export function findSection(markdown, heading) {
  if (typeof markdown !== 'string') return { ok: false, error: 'no-markdown' };
  if (typeof heading !== 'string' || heading.trim() === '') return { ok: false, error: 'no-heading' };
  const want = heading.trim();
  const lines = markdown.split('\n');
  for (let hi = 0; hi < lines.length; hi++) {
    const lvl = headingLevel(lines[hi]);
    if (!lvl) continue;
    if (headingText(lines[hi]) !== want) continue;
    // body ends at the next heading of level <= lvl (or EOF)
    let bi = lines.length;
    for (let j = hi + 1; j < lines.length; j++) {
      const lj = headingLevel(lines[j]);
      if (lj && lj <= lvl) { bi = j; break; }
    }
    return { ok: true, level: lvl, headingIndex: hi, bodyEnd: bi };
  }
  return { ok: false, error: 'heading-not-found' };
}

// sanitizeBullet(text) → a single-line bullet body string, or '' if empty.
// Internal newlines/CR are collapsed to single spaces so a bullet is always one
// line (a bullet is one list item, not a block).
function sanitizeBullet(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\r/g, '').replace(/\n/g, ' ').trim();
}

// appendBulletUnderHeading(markdown, heading, bullet) → { ok, markdown?, error? }.
//
// Appends `- <bullet>` as the last content line of the named section's body.
//   - If the section body is empty, the bullet is placed on the line right after
//     the heading (a blank line is added before a following heading).
//   - If the last content line is already a list item, the bullet is appended
//     directly after it (contiguous list).
//   - Otherwise (prose/other), a blank line is inserted before the bullet.
// All other lines are preserved byte-for-byte (round-trips via split('\n')).
export function appendBulletUnderHeading(markdown, heading, bullet) {
  const found = findSection(markdown, heading);
  if (!found.ok) return found;
  const body = sanitizeBullet(bullet);
  if (body === '') return { ok: false, error: 'empty-bullet' };
  const bulletLine = `- ${body}`;
  const lines = markdown.split('\n');
  const { headingIndex: hi, bodyEnd: bi } = found;

  // last non-blank content line within the body [hi+1, bi)
  let lastNonBlank = -1;
  for (let i = hi + 1; i < bi; i++) {
    if (!isBlank(lines[i])) lastNonBlank = i;
  }

  let insertion;
  if (lastNonBlank === -1) {
    // empty body → bullet goes right under the heading
    insertion = [bulletLine];
  } else {
    const last = lines[lastNonBlank];
    const lastIsBullet = /^\s*[-*+]\s+/.test(last);
    // insert right after the last content line (trailing blanks before the next
    // heading are preserved AFTER the bullet)
    insertion = lastIsBullet ? [bulletLine] : ['', bulletLine];
  }
  const insertAt = lastNonBlank === -1 ? hi + 1 : lastNonBlank + 1;
  lines.splice(insertAt, 0, ...insertion);

  // if the bullet now sits immediately before a heading with no blank between,
  // add a separating blank line
  const bulletIdx = insertAt + (insertion.length === 2 ? 1 : 0);
  if (bulletIdx + 1 < lines.length && headingLevel(lines[bulletIdx + 1]) && !isBlank(lines[bulletIdx + 1])) {
    lines.splice(bulletIdx + 1, 0, '');
  }

  return { ok: true, markdown: lines.join('\n') };
}

// formatStamp(date) → "YYYY-MM-DD HH:MM UTC". Deterministic, no locale, Z-suffix-free.
// Pure; never throws. Used by appendNote so a live note carries an audit stamp.
export function formatStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const mo = p(d.getUTCMonth() + 1);
  const da = p(d.getUTCDate());
  const h = p(d.getUTCHours());
  const mi = p(d.getUTCMinutes());
  return `${y}-${mo}-${da} ${h}:${mi} UTC`;
}

// appendNote(markdown, heading, text, stamp?) → { ok, markdown?, error? }.
//
// Appends a timestamped live-note bullet `- [stamp] text` as the last content
// line of the named section's body. Defaults `heading` to nothing (caller/CLI
// resolves the per-file default); `stamp` defaults to formatStamp(now). The
// bullet text is sanitized to one line. Delegates to appendBulletUnderHeading
// so all byte-preservation / blank-line rules are inherited.
export function appendNote(markdown, heading, text, stamp) {
  if (typeof markdown !== 'string') return { ok: false, error: 'no-markdown' };
  if (typeof heading !== 'string' || heading.trim() === '') return { ok: false, error: 'no-heading' };
  const body = sanitizeBullet(text);
  if (body === '') return { ok: false, error: 'empty-bullet' };
  const s = (typeof stamp === 'string' && stamp.trim() !== '') ? stamp.trim() : formatStamp();
  return appendBulletUnderHeading(markdown, heading, `[${s}] ${body}`);
}

// replaceNamedSection(markdown, section, body) → { ok, markdown?, error? }.
//
// Replaces the BODY of the named section (everything between the heading line
// and the next same-or-higher-level heading / EOF) with `body`. The heading line
// itself is preserved; everything outside the section is byte-identical. An empty
// body collapses the section to just its heading line.
export function replaceNamedSection(markdown, section, body) {
  const found = findSection(markdown, section);
  if (!found.ok) return found;
  if (typeof body !== 'string') return { ok: false, error: 'no-body' };
  const lines = markdown.split('\n');
  const { headingIndex: hi, bodyEnd: bi } = found;
  // an empty body collapses the section to just its heading line (no body lines)
  const bodyLines = body === '' ? [] : body.replace(/\r/g, '').split('\n');
  // replace [hi+1, bi) with the new body, preserving the heading line at hi
  lines.splice(hi + 1, bi - (hi + 1), ...bodyLines);
  return { ok: true, markdown: lines.join('\n') };
}

// listHeadings(markdown) → [{ level, text, line }] (read-only). Pure, never throws.
export function listHeadings(markdown) {
  if (typeof markdown !== 'string') return [];
  return markdown.split('\n')
    .map((line, i) => {
      const level = headingLevel(line);
      return level ? { level, text: headingText(line), line: i } : null;
    })
    .filter(Boolean);
}

// resolveTarget(root, filename) → { ok, path?, error? }. The security boundary.
//
// Accepts ONLY a bare basename that is in MD_PATCH_WHITELIST. Rejects:
//   - non-string / empty root                  → 'no-root'
//   - non-string / empty filename              → 'no-file'
//   - an absolute filename                     → 'absolute-path-not-allowed'
//   - any path separator / `..` / non-basename → 'path-separator-not-allowed'
//   - a basename not in the whitelist          → 'not-whitelisted'
//   - a resolved path that escapes root        → 'outside-repo' (defence-in-depth)
// Pure path math (no fs); never throws.
export function resolveTarget(root, filename) {
  if (typeof root !== 'string' || root.trim() === '') return { ok: false, error: 'no-root' };
  if (typeof filename !== 'string') return { ok: false, error: 'no-file' };
  const name = filename.trim();
  if (name === '') return { ok: false, error: 'no-file' };
  if (isAbsolute(name)) return { ok: false, error: 'absolute-path-not-allowed' };
  // a bare basename only: no separators, no traversal segments
  if (name !== basename(name)) return { ok: false, error: 'path-separator-not-allowed' };
  if (name === '.' || name === '..') return { ok: false, error: 'path-separator-not-allowed' };
  if (name.includes('..')) return { ok: false, error: 'path-separator-not-allowed' };
  if (!MD_PATCH_WHITELIST.includes(name)) return { ok: false, error: 'not-whitelisted' };
  const abs = resolve(root, name);
  const within = relative(root, abs);
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    return { ok: false, error: 'outside-repo' };
  }
  return { ok: true, path: abs };
}

// ── fs-backed apply (used by the CLI; safe to import in tests with a tmp root) ─

// resolveCapability(file, action) → { ok, error? }. True if the action is
// permitted for this whitelisted file. Pure; never throws.
export function resolveCapability(file, action) {
  const caps = capabilityFor(file);
  if (!caps.length) return { ok: false, error: 'not-whitelisted' };
  if (!caps.includes(action)) return { ok: false, error: 'action-not-permitted', action, allowed: caps };
  return { ok: true };
}

// applyPatch({ root, file, action, heading, bullet, section, body, stamp, dryRun }) →
//   { ok, path?, bakPath?, changed?, preview?, error? }.
//
// Resolves the target through resolveTarget, checks the per-file capability,
// reads the current bytes, runs the pure transform, and — unless dryRun — writes
// a `.bak` backup then the new bytes. Never creates a file that does not already
// exist (no arbitrary writes).
export function applyPatch({ root, file, action, heading, bullet, section, body, stamp, dryRun = false } = {}) {
  const target = resolveTarget(root, file);
  if (!target.ok) return target;
  const cap = resolveCapability(file, action);
  if (!cap.ok) return { ...cap, path: target.path };
  if (!existsSync(target.path)) return { ok: false, error: 'file-not-found', path: target.path };
  let current;
  try {
    current = readFileSync(target.path, 'utf8');
  } catch (e) {
    return { ok: false, error: 'read-failed', path: target.path, detail: String(e && e.message || e) };
  }

  let result;
  if (action === 'append') {
    result = appendBulletUnderHeading(current, heading, bullet);
  } else if (action === 'replace') {
    result = replaceNamedSection(current, section, body);
  } else if (action === 'note') {
    result = appendNote(current, heading, bullet, stamp);
  } else {
    return { ok: false, error: 'unknown-action', action, path: target.path };
  }
  if (!result.ok) return { ...result, path: target.path };

  const next = result.markdown;
  if (next === current) {
    return { ok: true, path: target.path, changed: false, dryRun };
  }

  if (dryRun) {
    return { ok: true, path: target.path, changed: true, dryRun: true, preview: next };
  }

  const bakPath = `${target.path}.bak`;
  try {
    copyFileSync(target.path, bakPath); // backup BEFORE the edit
    writeFileSync(target.path, next, 'utf8');
  } catch (e) {
    return { ok: false, error: 'write-failed', path: target.path, detail: String(e && e.message || e) };
  }
  return { ok: true, path: target.path, bakPath, changed: true, dryRun: false };
}

// ── CLI entry (guarded so importing the module for tests never runs it) ──────

function parseArgs(argv) {
  // Flags: --dry-run, --root <dir>, --stdin, --heading <h>. Remainder are positional.
  const out = { action: null, positional: [], dryRun: false, root: null, stdin: false, heading: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (a === '--stdin') { out.stdin = true; continue; }
    if (a === '--root') { out.root = argv[++i]; continue; }
    if (a === '--heading') { out.heading = argv[++i]; continue; }
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    out.positional.push(a);
  }
  if (out.positional.length) out.action = out.positional[0];
  return out;
}

const HELP = `mdPatch — safe repo-local markdown patcher (todos / progress / handoff)

Usage:
  npm run md:patch -- append <file> <heading> <bullet...>   [--dry-run] [--root <dir>]
  npm run md:patch -- replace <file> <section> [<body...>]  [--dry-run] [--root <dir>] [--stdin]
  npm run md:patch -- note   <file> <text...>  [--heading <h>] [--dry-run] [--root <dir>]
  npm run md:patch -- list   <file>                          [--root <dir>]

Actions:
  append   add "- <bullet>" as the last content line under heading <heading>
  replace  replace the body of the named <section> with <body> (heading line kept)
  note     add a timestamped live note "- [YYYY-MM-DD HH:MM UTC] <text>" under the
           file's default heading (overridable with --heading <h>)
  list     (read-only) print every heading with its level

Whitelist (only these may be edited): ${MD_PATCH_WHITELIST.join(', ')}
Capabilities: torii-quest-handoff.md is append-only (no replace); all others allow replace.
Default note headings: quest-todo=Active MVP tasks · continuum-todo=Active tasks ·
  todo=Source of truth (active task queues) · progress=Active now ·
  HANDOFF=8. Active issues / open edges
Safety: .bak backup before every edit · path-traversal rejected · no network · no
arbitrary file writes. Replace body via --stdin for multiline content; \\n in a
positional <body> is also unescaped to newlines.

Exit codes: 0 ok / no-change · 1 rejected or errored.`;

function unescapeNewlines(s) {
  return s.replace(/\\n/g, '\n');
}

async function readStdin() {
  return new Promise((resolveP) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolveP(data));
    process.stdin.on('error', () => resolveP(''));
  });
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.action) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  const root = args.root || process.cwd();
  const pos = args.positional.slice(1); // drop the action token

  if (args.action === 'list') {
    const file = pos[0];
    const target = resolveTarget(root, file);
    if (!target.ok) { process.stderr.write(`mdPatch: rejected (${target.error})\n`); return 1; }
    if (!existsSync(target.path)) { process.stderr.write(`mdPatch: file not found: ${file}\n`); return 1; }
    const md = readFileSync(target.path, 'utf8');
    for (const h of listHeadings(md)) {
      process.stdout.write(`${'#'.repeat(h.level)} ${h.text}  (line ${h.line + 1})\n`);
    }
    return 0;
  }

  if (args.action === 'append') {
    const [file, heading, ...bulletParts] = pos;
    const bullet = bulletParts.join(' ');
    if (!file || heading === undefined || bullet === '') {
      process.stderr.write('mdPatch: usage: append <file> <heading> <bullet...>\n');
      return 1;
    }
    const r = applyPatch({ root, file, action: 'append', heading, bullet, dryRun: args.dryRun });
    return report(r, args.dryRun);
  }

  if (args.action === 'note') {
    const [file, ...textParts] = pos;
    const text = textParts.join(' ');
    if (!file || text === '') {
      process.stderr.write('mdPatch: usage: note <file> <text...> [--heading <h>]\n');
      return 1;
    }
    const heading = args.heading || MD_PATCH_NOTE_HEADING[file.trim()];
    if (!heading) {
      process.stderr.write(`mdPatch: no default note heading for ${file} — pass --heading <h>\n`);
      return 1;
    }
    const r = applyPatch({ root, file, action: 'note', heading, bullet: text, dryRun: args.dryRun });
    return report(r, args.dryRun);
  }

  if (args.action === 'replace') {
    const [file, section, ...bodyParts] = pos;
    let body;
    if (args.stdin) {
      body = await readStdin();
    } else {
      body = unescapeNewlines(bodyParts.join(' '));
    }
    if (!file || section === undefined) {
      process.stderr.write('mdPatch: usage: replace <file> <section> [<body...>]\n');
      return 1;
    }
    const r = applyPatch({ root, file, action: 'replace', section, body, dryRun: args.dryRun });
    return report(r, args.dryRun);
  }

  process.stderr.write(`mdPatch: unknown action "${args.action}"\n${HELP}\n`);
  return 1;
}

function report(r, dryRun) {
  if (!r.ok) {
    process.stderr.write(`mdPatch: ${r.error || 'failed'}${r.path ? ` (${r.path})` : ''}\n`);
    return 1;
  }
  if (r.changed === false) {
    process.stdout.write(`mdPatch: no change (${r.path})\n`);
    return 0;
  }
  if (dryRun || r.dryRun) {
    process.stdout.write(`mdPatch: dry-run ok — would write (${r.path})\n`);
    if (r.preview) process.stdout.write('--- preview ---\n' + r.preview + '\n--- /preview ---\n');
    return 0;
  }
  process.stdout.write(`mdPatch: wrote ${r.path} (backup: ${r.bakPath})\n`);
  return 0;
}

// Run only when invoked directly as a script, not when imported for tests.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
