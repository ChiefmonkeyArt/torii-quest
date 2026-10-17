// src/engine/kami/diagKey.js — ADR-0134 diagnostics recipient (node-pure).
//
// The 1 Hz AUTOCAP ring is sealed to the owner, Kami AND this key, so a
// gameplay session can review the run-up to a glitch without the owner's or
// Kami's private keys. The private half exists only as the TORII_DIAG_PRIV
// GitHub secret (.github/workflows/autocap-pull.yml). Manual ema notes are
// NEVER sealed to it. Rotate: new keypair → secret + this constant.
export const DIAG_PUBKEY = '191a3554f1c24d6a5c4152cda8afb38422ffc0f858597d95a837c71ea2739b85';
