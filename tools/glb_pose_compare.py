#!/usr/bin/env python3
"""Compare baked nostrich-master poses against the animation-library source.

1. Per-bone world DIRECTION deviation (parent->child bone axis) in the common
   game frame, per clip, at several sample times. Exposes twisted limbs.
2. Quaternion hemisphere continuity per rotation track (dot(q[k],q[k-1]) < 0
   means the mixer interpolates the long way -> glitchy/messy motion).

Game frame mapping (from arenaRuntime/playerModel):
  library (Z-up): F = RotY(pi) * RotX(+pi/2)
  master  (Y-up): F = RotY(pi)
"""
import sys
import numpy as np

sys.path.insert(0, '/home/user/workspace/torii-quest/tools')
from glb_retarget import load_glb, Rig, read_accessor, sample_track, trs, mat2q


def rotx(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1.0]])


def roty(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1.0]])


def pose_world(rig, anim, t):
    tracks = rig.clip_tracks(anim)
    locals_ = []
    for i, name in enumerate(rig.names):
        tr = tracks.get(name, {})
        if 'rotation' in tr:
            q = sample_track(*tr['rotation'], t, True)
        else:
            m = rig.bind_local[i][:3, :3]
            q = mat2q(m / np.linalg.norm(m, axis=0))
        tt = rig.bind_local[i][:3, 3].copy()
        if 'translation' in tr:
            tt = sample_track(*tr['translation'], t, False)
        s = np.linalg.norm(rig.bind_local[i][:3, :3], axis=0)
        locals_.append(trs(tt, q, s))
    return rig._fk(locals_)


BONE_CHAINS = [
    ('Hips', 'Spine'), ('Spine', 'Spine01'), ('Spine01', 'Spine02'),
    ('Spine02', 'neck'), ('neck', 'Head'),
    ('LeftShoulder', 'LeftArm'), ('LeftArm', 'LeftForeArm'), ('LeftForeArm', 'LeftHand'),
    ('RightShoulder', 'RightArm'), ('RightArm', 'RightForeArm'), ('RightForeArm', 'RightHand'),
    ('LeftUpLeg', 'LeftLeg'), ('LeftLeg', 'LeftFoot'), ('LeftFoot', 'LeftToeBase'),
    ('RightUpLeg', 'RightLeg'), ('RightLeg', 'RightFoot'), ('RightFoot', 'RightToeBase'),
]


def main():
    lib_path = sys.argv[1] if len(sys.argv) > 1 else 'public/models/animation-library.glb'
    mas_path = sys.argv[2] if len(sys.argv) > 2 else 'public/models/nostrich-master.glb'
    clips = sys.argv[3].split(',') if len(sys.argv) > 3 else ['Idle_02', 'Running', 'Walk_Backward']

    gl, bl = load_glb(lib_path)
    gm, bm = load_glb(mas_path)
    rl, rm = Rig(gl, bl), Rig(gm, bm)
    il = {n: i for i, n in enumerate(rl.names)}
    im = {n: i for i, n in enumerate(rm.names)}

    F_lib = roty(np.pi) @ rotx(np.pi / 2)
    F_mas = roty(np.pi)

    # ── hemisphere continuity on master ──────────────────────────────────────
    print('=== hemisphere continuity (nostrich-master rotation tracks) ===')
    worst = []
    for anim in gm.get('animations', []):
        flips = 0
        keys = 0
        for ch in anim['channels']:
            if ch['target']['path'] != 'rotation':
                continue
            s = anim['samplers'][ch['sampler']]
            times, vals = read_accessor(gm, bm, s['input']), read_accessor(gm, bm, s['output'])
            keys += len(vals)
            for k in range(1, len(vals)):
                if np.dot(vals[k], vals[k - 1]) < 0:
                    flips += 1
        if flips:
            worst.append((anim['name'], flips, keys))
    if worst:
        for name, flips, keys in worst:
            print(f'  {name:<26} {flips} sign flips across {keys} keys')
    else:
        print('  no sign flips — continuity clean')

    # ── per-bone direction deviation ─────────────────────────────────────────
    print('=== bone-axis deviation (degrees, master vs library, game frame) ===')
    for clip in clips:
        al = next(a for a in gl['animations'] if a['name'] == clip)
        am = next(a for a in gm['animations'] if a['name'] == clip)
        dur = max(times[-1] for tr in rl.clip_tracks(al).values() for times, _ in tr.values())
        print(f'  clip {clip} (dur {dur:.2f}s)')
        for frac in (0.0, 0.25, 0.5):
            t = dur * frac
            wl = pose_world(rl, al, t)
            wm = pose_world(rm, am, t)
            rows = []
            for parent, child in BONE_CHAINS:
                if parent not in il or child not in il or parent not in im or child not in im:
                    continue
                vl = np.append(wl[il[child]][:3, 3] - wl[il[parent]][:3, 3], 0.0)
                vm = np.append(wm[im[child]][:3, 3] - wm[im[parent]][:3, 3], 0.0)
                dl = (F_lib @ vl)[:3]
                dm = (F_mas @ vm)[:3]
                if np.linalg.norm(dl) < 1e-6 or np.linalg.norm(dm) < 1e-6:
                    continue
                dl = dl / np.linalg.norm(dl)
                dm = dm / np.linalg.norm(dm)
                ang = np.degrees(np.arccos(np.clip(np.dot(dl, dm), -1, 1)))
                rows.append((ang, f'{parent}->{child}'))
            rows.sort(reverse=True)
            top = ', '.join(f'{n} {a:.0f}deg' for a, n in rows[:5])
            print(f'    t={t:5.2f}  worst: {top}')


if __name__ == '__main__':
    main()
