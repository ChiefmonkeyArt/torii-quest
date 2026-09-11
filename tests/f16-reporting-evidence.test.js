// tests/f16-reporting-evidence.test.js — audit F16: status/reporting artifacts must
// not report success without their claimed evidence. The pure module behaviours are
// covered in their own tests (smoke skip-only, release-manifest UNKNOWN, rc-snapshot
// unknown dry-run, playtest canonical IDs). This file locks the two CLI-gather-layer
// fixes that sit outside those pure modules.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('F16 — approval projection derives from .status, not a phantom .approved', () => {
  const src = readFileSync(join(ROOT, 'tools', 'next-action-state.mjs'), 'utf8');
  it('reads the approval record as .status === approved', () => {
    expect(src).toContain('mvpApproval.status === MVP_APPROVAL_STATUSES.APPROVED');
  });
  it('no longer reads a non-existent .approved boolean', () => {
    expect(src).not.toContain('mvpApproval.approved === true');
  });
});

describe('F16 — an unreadable artifact is not a verified presence', () => {
  const src = readFileSync(join(ROOT, 'tools', 'release-manifest.mjs'), 'utf8');
  it('degrades an unreadable file to present:null (unknown), not present:true', () => {
    // The read-failure catch path must not emit present:true with a null hash.
    expect(src).toMatch(/return \{ present: null, sha256: null, bytes: null \}/);
  });
});