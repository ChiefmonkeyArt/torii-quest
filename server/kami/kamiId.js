// kamiId.js — strict generated-ID grammar for Kami record filenames (audit F10).
//
// Manual shots are written to `${id}.bin` and auto-capture frames to
// `${id}.json` beneath their store directories. The ID is a transport record
// identifier that was formerly reused as a filesystem name with no storage
// boundary, so a crafted value could escape the intended subdirectory.
//
// The accepted grammar is deliberately narrow: a leading alphanumeric (no `.`
// or `..` relative traversal), then only [A-Za-z0-9_-], and at most 64 chars.
// This admits the client-generated `ema_<base36>_<hex6>` form while excluding
// path separators, backslashes, absolute paths, drive letters, symlink tricks
// and any `..` sequence. Anything else is rejected before it can touch disk.
//
// Pure: no fs, no HTTP. Shared by kamiRoute (batch filter) and both stores
// (defense-in-depth at the write boundary).

const KAMI_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidKamiId(id) {
  return typeof id === 'string' && KAMI_ID_RE.test(id);
}