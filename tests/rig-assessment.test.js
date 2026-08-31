// tests/rig-assessment.test.js — locks the auto-rig assessment
// (src/engine/character/rigAssessment.js): the verdict ladder over a GLB's
// bone-name list. Pure module → fully node-testable.
import { describe, it, expect } from 'vitest';
import { assessRig, canAutoRig, RIG_ASSESSMENT_VERSION } from '../src/engine/character/rigAssessment.js';
import * as SDK from '../src/sdk/index.js';

const FULL_MIXAMO = [
  'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
  'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftShoulder', 'mixamorigRightShoulder',
  'mixamorigLeftArm', 'mixamorigRightArm',
  'mixamorigLeftForeArm', 'mixamorigRightForeArm',
  'mixamorigLeftHand', 'mixamorigRightHand',
  'mixamorigLeftUpLeg', 'mixamorigRightUpLeg',
  'mixamorigLeftLeg', 'mixamorigRightLeg',
  'mixamorigLeftFoot', 'mixamorigRightFoot',
  'mixamorigLeftToeBase', 'mixamorigRightToeBase',
];

describe('assessRig', () => {
  it('declares a version', () => {
    expect(typeof RIG_ASSESSMENT_VERSION).toBe('number');
  });

  it('verdicts a full Mixamo skeleton as riggable', () => {
    const r = assessRig(FULL_MIXAMO);
    expect(r.verdict).toBe('riggable');
    expect(r.convention).toBe('mixamo');
    expect(r.boneCount).toBe(FULL_MIXAMO.length);
  });

  it('verdicts a partial skeleton as partial with the missing roles named', () => {
    const r = assessRig(['mixamorigHips', 'mixamorigSpine', 'mixamorigHead']);
    expect(r.verdict).toBe('partial');
    expect(r.requiredMissing).toContain('Neck');
    expect(r.requiredMissing).toContain('LeftHand');
  });

  it('verdicts unknown names as unknown-convention', () => {
    const r = assessRig(['root', 'chest', 'skull']);
    expect(r.verdict).toBe('unknown-convention');
  });

  it('verdicts an empty list as no-bones', () => {
    const r = assessRig([]);
    expect(r.verdict).toBe('no-bones');
    expect(r.boneCount).toBe(0);
  });

  it('flags unmapped bones as extra', () => {
    const r = assessRig(['mixamorigHips', 'mixamorigSpine', 'mixamorigNeck', 'mixamorigHead',
      'mixamorigLeftArm', 'mixamorigRightArm', 'mixamorigLeftForeArm', 'mixamorigRightForeArm',
      'mixamorigLeftHand', 'mixamorigRightHand', 'mixamorigLeftUpLeg', 'mixamorigRightUpLeg',
      'mixamorigLeftLeg', 'mixamorigRightLeg', 'mixamorigLeftFoot', 'mixamorigRightFoot',
      'someWeirdBone']);
    expect(r.verdict).toBe('riggable');
    expect(r.extra).toContain('someWeirdBone');
  });
});

describe('canAutoRig', () => {
  it('is true only for a clean riggable verdict', () => {
    expect(canAutoRig(FULL_MIXAMO)).toBe(true);
    expect(canAutoRig(['mixamorigHips'])).toBe(false);
    expect(canAutoRig([])).toBe(false);
  });
});

describe('SDK exposure', () => {
  it('re-exports rigAssessment at the experimental tier', () => {
    expect(SDK.rigAssessment.assessRig).toBe(assessRig);
    expect(SDK.SDK_SURFACE.rigAssessment.tier).toBe('experimental');
  });
});
