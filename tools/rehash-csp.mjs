// Recompute the default-root fallback CSP sha256 from index.html's inline bootstrap
// and rewrite INLINE_SCRIPT_SHA256 in tools/csp.mjs in place. Called by bump-ver.sh
// after it bumps the version — the version literal lives inside the inline
// bootstrap, so every bump shifts its hash and would otherwise fail
// tests/sw-app-shell.test.js. Reuses the exact helpers that test asserts against
// (inlineBootstrapSourceOf + ENTRY_IMPORT_LINE), so this cannot drift from the gate.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inlineBootstrapSourceOf, ENTRY_IMPORT_LINE } from './csp.mjs';

const html = readFileSync('index.html', 'utf8');
const fallback =
  inlineBootstrapSourceOf(html).replaceAll('%BASE_URL%', '/') + ENTRY_IMPORT_LINE + '\n';
const sha = 'sha256-' + createHash('sha256').update(fallback, 'utf8').digest('base64');

const path = 'tools/csp.mjs';
const text = readFileSync(path, 'utf8');
const next = text.replace(/INLINE_SCRIPT_SHA256 = "[^"]*"/, `INLINE_SCRIPT_SHA256 = "${sha}"`);
if (next === text) {
  console.error('INLINE_SCRIPT_SHA256 not found in tools/csp.mjs — aborting');
  process.exit(1);
}
writeFileSync(path, next);
console.log(`csp sha256 re-pinned: ${sha}`);