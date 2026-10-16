// src/gamezone/client/botTemplates.js — per-kind model + animation table (ADR-0130).
//
// Data only (no THREE) so the bench, tests and the renderer share one table.
//   neckY    rest-pose (geometry-space) height of the neck line; vertices at or
//            above it are the HEAD zone. Measured from the meshes: banker
//            geometry is 1.70 m tall with face + hat above 1.42 m; augustink4
//            geometry is 1.665 m tall with the head above 1.37 m.
//   target   rendered height in metres (0 = use the model's own metre scale).
//   anims    sim anim code → clip name (+ timeScale, loop flag).

import { BOSS_TARGET_HEIGHT } from '../../config.js';

export const BOT_TEMPLATES = Object.freeze({
  regular: Object.freeze({
    url: '/banker-rigged.glb', target: 0, neckY: 1.42,
    anims: Object.freeze({
      idle:    { clip: 'Walking', timeScale: 0.0 },
      walk:    { clip: 'Walking', timeScale: 1 },
      run:     { clip: 'Running', timeScale: 1 },
      shoot:   { clip: 'Run_and_Shoot', timeScale: 1 },
      strafeL: { clip: 'Walk_Left_with_Gun_inplace', timeScale: 1 },
      strafeR: { clip: 'Walk_Left_with_Gun_inplace', timeScale: -1 },
      die:     { clip: 'Shot_and_Blown_Back', timeScale: 1.25, once: true },
    }),
  }),
  boss: Object.freeze({
    url: '/augustink4.glb', target: BOSS_TARGET_HEIGHT, neckY: 1.37,
    anims: Object.freeze({
      idle:    { clip: 'Walking', timeScale: 0.0 },
      walk:    { clip: 'Walking', timeScale: 1 },
      run:     { clip: 'Running', timeScale: 1 },
      shoot:   { clip: 'Running', timeScale: 1 },
      strafeL: { clip: 'Walking', timeScale: 1 },
      strafeR: { clip: 'Walking', timeScale: 1 },
      die:     { clip: 'Dead', timeScale: 1, once: true },
    }),
  }),
});
