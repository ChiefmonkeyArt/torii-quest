#!/usr/bin/env python3
"""Validate a retargeted GLB: FK-pose every clip, check world-space sanity."""
import struct, json, sys
import numpy as np

sys.path.insert(0, '/home/user/workspace/tools')
from glb_retarget import load_glb, Rig, read_accessor, sample_track

def pose_world(rig, anim, t):
    tracks = rig.clip_tracks(anim)
    import numpy as np
    from glb_retarget import trs, mat2q
    locals_ = []
    for i, name in enumerate(rig.names):
        tr = tracks.get(name, {})
        if 'rotation' in tr:
            q = sample_track(*tr['rotation'], t, True)
        else:
            m = rig.bind_local[i][:3,:3]
            q = mat2q(m / np.linalg.norm(m, axis=0))
        tt = rig.bind_local[i][:3,3].copy()
        if 'translation' in tr:
            tt = sample_track(*tr['translation'], t, False)
        s = np.linalg.norm(rig.bind_local[i][:3,:3], axis=0)
        locals_.append(trs(tt, q, s))
    return rig._fk(locals_)

def validate(path):
    g, b = load_glb(path)
    rig = Rig(g, b)
    names = rig.names
    idx = {n: i for i, n in enumerate(names)}
    hips_i = idx.get('Hips'); head_i = idx.get('Head')
    lf_i = idx.get('LeftFoot'); rf_i = idx.get('RightFoot')

    print(f"=== {path.split('/')[-1]} ===")
    # bind pose reference heights (root scale 0.01 applied through FK already)
    bw = rig.bind_world
    print(f"bind world: Hips y={bw[hips_i][1,3]:.3f}  Head y={bw[head_i][1,3]:.3f}  "
          f"LFoot y={bw[lf_i][1,3]:.3f}  RFoot y={bw[rf_i][1,3]:.3f}")

    allok = True
    for anim in g.get('animations', []):
        tracks = rig.clip_tracks(anim)
        dur = max(times[-1] for tr in tracks.values() for times, _ in tr.values())
        issues = []
        prev_hips = None
        max_jump = 0.0
        n = 40
        for k in range(n):
            t = dur * k / (n-1)
            w = pose_world(rig, anim, t)
            hy = w[head_i][1,3]
            hips = w[hips_i][:3,3]
            lfy, rfy = w[lf_i][1,3], w[rf_i][1,3]
            # limb explosion: any joint >3m from hips
            expl = [names[i] for i in range(len(names))
                    if np.linalg.norm(w[i][:3,3] - hips) > 3.0]
            if expl: issues.append(f"t={t:.2f} explosion {expl}")
            if hy < 0.3: issues.append(f"t={t:.2f} head low {hy:.2f}")
            if min(lfy, rfy) < -0.30: issues.append(f"t={t:.2f} feet under floor {min(lfy,rfy):.2f}")
            if prev_hips is not None:
                d = np.linalg.norm(hips - prev_hips) / (dur/(n-1) + 1e-9)
                max_jump = max(max_jump, d)
            prev_hips = hips
        status = 'OK' if not issues else f"{len(issues)} ISSUES"
        if issues: allok = False
        print(f"  {anim.get('name','?'):32s} dur={dur:5.2f}s  max hips vel={max_jump:6.2f} m/s  {status}")
        for i in issues[:3]:
            print(f"      {i}")
    return allok

if __name__ == '__main__':
    ok = validate(sys.argv[1])
    print("ALL OK" if ok else "ISSUES FOUND")
