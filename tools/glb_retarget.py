#!/usr/bin/env python3
"""
glb_retarget.py - bake animation clips from a master-rig GLB onto a target-rig GLB.

Both rigs must share bone NAMES (Meshy standard 24-bone biped). Bind conventions
may differ: the retarget maps every bone's world-space rotation delta from the
master bind into the target's local frame.

Method (per bone, per sample):
    world_l   = parent_world_l * local_l(t)          (master FK)
    delta     = world_l * inv(bind_world_l)          (world-space delta from bind)
    world_t   = delta * bind_world_t                 (apply to target bind world)
    local_t   = inv(parent_world_t) * world_t        (target parent at rest)
    q_out     = rotation quaternion of local_t

Root (Hips) translation is retargeted as world delta scaled by hips-height ratio:
    t_out_world = bind_world_t + (t_world_l(t) - bind_world_l) * (h_t / h_l)
    converted back into target-root local space.

Output: a new GLB containing the TARGET's scene/mesh/skin unchanged plus all
master clips rewritten for the target skeleton.

Usage:
    python3 glb_retarget.py MASTER.glb TARGET.glb OUT.glb [--fps 30] [--validate]
"""

import struct, json, sys, math, copy
import numpy as np

# ---------------------------------------------------------------- GLB I/O ---

CTYPES = {5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
NCOMP  = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def load_glb(path):
    with open(path,'rb') as f:
        magic, ver, length = struct.unpack('<III', f.read(12))
        assert magic == 0x46546C67, 'not a GLB'
        chunks = []
        while f.tell() < length:
            clen, ctype = struct.unpack('<II', f.read(8))
            chunks.append((ctype, f.read(clen)))
    gltf = json.loads(chunks[0][1])
    binchunk = chunks[1][1] if len(chunks) > 1 else b''
    return gltf, bytearray(binchunk)

def save_glb(path, gltf, binchunk):
    js = json.dumps(gltf, separators=(',',':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    binchunk = bytes(binchunk) + b'\x00' * ((4 - len(binchunk) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binchunk)
    with open(path,'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binchunk), 0x004E4942)); f.write(binchunk)

def read_accessor(gltf, binchunk, idx):
    acc = gltf['accessors'][idx]
    bv  = gltf['bufferViews'][acc['bufferView']]
    off = bv.get('byteOffset',0) + acc.get('byteOffset',0)
    fmtc, sz = CTYPES[acc['componentType']]
    n = NCOMP[acc['type']]
    count = acc['count']
    stride = bv.get('byteStride') or n*sz
    out = np.zeros((count, n), dtype=np.float64)
    for i in range(count):
        vals = struct.unpack_from('<'+fmtc*n, binchunk, off + i*stride)
        out[i] = vals
    return out

def append_accessor(gltf, binchunk, arr, acc_type, normalized=False, comp=5126):
    arr = np.asarray(arr, dtype=np.float32)
    flat = arr.reshape(arr.shape[0], -1) if arr.ndim > 1 else arr.reshape(-1,1)
    data = flat.astype('<f4').tobytes()
    while len(binchunk) % 4: binchunk.append(0)
    bv_off = len(binchunk)
    binchunk.extend(data)
    gltf.setdefault('bufferViews', []).append(
        {'buffer':0,'byteOffset':bv_off,'byteLength':len(data)})
    acc = {'bufferView': len(gltf['bufferViews'])-1,
           'componentType': comp, 'count': int(arr.shape[0]), 'type': acc_type}
    if acc_type == 'SCALAR':
        acc['min'] = [float(flat.min())]; acc['max'] = [float(flat.max())]
    gltf.setdefault('accessors', []).append(acc)
    return len(gltf['accessors'])-1

# ------------------------------------------------------------- quat / mat ---

def qmul(a, b):
    ax,ay,az,aw = a; bx,by,bz,bw = b
    return np.array([
        aw*bx + ax*bw + ay*bz - az*by,
        aw*by - ax*bz + ay*bw + az*bx,
        aw*bz + ax*by - ay*bx + az*bw,
        aw*bw - ax*bx - ay*by - az*bz])

def qinv(q):
    return np.array([-q[0],-q[1],-q[2],q[3]])

def qnorm(q):
    return q / np.linalg.norm(q)

def q2mat(q):
    x,y,z,w = q
    return np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w),   2*(x*z+y*w)],
        [2*(x*y+z*w),   1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w),   2*(y*z+x*w),   1-2*(x*x+y*y)]])

def mat2q(m):
    t = np.trace(m)
    if t > 0:
        s = math.sqrt(t+1.0)*2
        return qnorm(np.array([(m[2,1]-m[1,2])/s,(m[0,2]-m[2,0])/s,(m[1,0]-m[0,1])/s,0.25*s]))
    i = int(np.argmax([m[0,0],m[1,1],m[2,2]]))
    if i == 0:
        s = math.sqrt(1.0+m[0,0]-m[1,1]-m[2,2])*2
        return qnorm(np.array([0.25*s,(m[0,1]+m[1,0])/s,(m[0,2]+m[2,0])/s,(m[2,1]-m[1,2])/s]))
    if i == 1:
        s = math.sqrt(1.0+m[1,1]-m[0,0]-m[2,2])*2
        return qnorm(np.array([(m[0,1]+m[1,0])/s,0.25*s,(m[1,2]+m[2,1])/s,(m[0,2]-m[2,0])/s]))
    s = math.sqrt(1.0+m[2,2]-m[0,0]-m[1,1])*2
    return qnorm(np.array([(m[0,2]+m[2,0])/s,(m[1,2]+m[2,1])/s,0.25*s,(m[1,0]-m[0,1])/s]))

def trs(t, q, s):
    m = np.eye(4)
    m[:3,:3] = q2mat(q) * np.asarray(s)
    m[:3,3] = t
    return m

def node_trs(n):
    if 'matrix' in n:
        return np.array(n['matrix']).reshape(4,4).T
    return trs(n.get('translation',[0,0,0]),
               n.get('rotation',[0,0,0,1]),
               n.get('scale',[1,1,1]))

# --------------------------------------------------------------- skeleton ---

class Rig:
    def __init__(self, gltf, binchunk):
        self.gltf = gltf
        self.bin  = binchunk
        self.nodes = gltf['nodes']
        skin = gltf['skins'][0]
        self.joint_ids = skin['joints']
        self.names = [self.nodes[j].get('name') for j in self.joint_ids]
        self.name2jid = {n:i for i,n in enumerate(self.names)}
        # node index -> joint index (joints only)
        self.node2jid = {nid:i for i,nid in enumerate(self.joint_ids)}
        # parents (node graph)
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        # root node above Hips (armature) - its TRS applies to world too
        # bind locals
        self.bind_local = []
        for nid in self.joint_ids:
            self.bind_local.append(node_trs(self.nodes[nid]))
        # bind world (FK over node graph from scene root)
        self.bind_world = self._fk(self.bind_local)
        self.bind_world_rot = {}
        self.bind_world_t   = {}
        for i, name in enumerate(self.names):
            m = self.bind_world[i]
            self.bind_world_rot[name] = mat2q(m[:3,:3] / np.linalg.norm(m[:3,:3],axis=0))
            self.bind_world_t[name]   = m[:3,3].copy()

    def _fk(self, locals_):
        """locals_: per-joint 4x4. Returns per-joint world 4x4 (includes non-joint ancestors)."""
        world = [None]*len(self.joint_ids)
        node_world = {}
        def world_of(nid):
            if nid in node_world: return node_world[nid]
            m = node_trs(self.nodes[nid])
            p = self.parent.get(nid)
            w = (world_of(p) @ m) if p is not None else m
            node_world[nid] = w
            return w
        for i, nid in enumerate(self.joint_ids):
            p = self.parent.get(nid)
            pw = world_of(p) if p is not None else np.eye(4)
            world[i] = pw @ locals_[i]
            node_world[nid] = world[i]
        return world

    def clip_tracks(self, anim):
        """Returns {bone_name: {'rotation': (times, quats), 'translation': (times, vecs)}}"""
        out = {}
        for ch in anim['channels']:
            tgt = ch['target']
            nid = tgt['node']
            if nid not in self.node2jid: continue
            name = self.names[self.node2jid[nid]]
            samp = anim['samplers'][ch['sampler']]
            times = read_accessor(self.gltf, self.bin, samp['input']).reshape(-1)
            vals  = read_accessor(self.gltf, self.bin, samp['output'])
            e = out.setdefault(name, {})
            e[tgt['path']] = (times, vals)
        return out

# --------------------------------------------------------------- sampling ---

def sample_track(times, vals, t, is_quat):
    if t <= times[0]:  return vals[0].copy()
    if t >= times[-1]: return vals[-1].copy()
    i = int(np.searchsorted(times, t) - 1)
    i = max(0, min(i, len(times)-2))
    t0, t1 = times[i], times[i+1]
    a = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
    v0, v1 = vals[i], vals[i+1]
    if is_quat:
        if np.dot(v0, v1) < 0: v1 = -v1
        return qnorm(v0 + (v1 - v0) * a)
    return v0 + (v1 - v0) * a

# --------------------------------------------------------------- retarget ---

def retarget(master, target, anim, fps=30):
    tracks = master.clip_tracks(anim)
    dur = 0.0
    for name, tr in tracks.items():
        for path, (times, _) in tr.items():
            dur = max(dur, times[-1])
    nfr = max(2, int(round(dur * fps)) + 1)
    times_out = np.linspace(0, dur, nfr)

    hips_l = 'Hips'
    h_l = np.linalg.norm(master.bind_world_t[hips_l])
    h_t = np.linalg.norm(target.bind_world_t[hips_l])
    scale = h_t / h_l if h_l > 1e-9 else 1.0

    # Frame change: the master's clips hold the body lying along -Z in raw
    # world space (the game stands it up externally with a quaternion). The
    # target is natively Y-up standing. Conjugate every world delta by the
    # Z-up -> Y-up rotation so 'lean toward -Z' becomes 'stand along +Y'.
    Fm = np.array([[1,0,0],[0,0,1],[0,-1,0]], float)   # (x,y,z) -> (x,-z,y)
    F4 = np.eye(4); F4[:3,:3] = Fm
    F4inv = np.linalg.inv(F4)

    # Precompute target bind-parent world rotations (parents at rest).
    t_parent_world_rot = {}
    t_parent_world     = {}
    for i, name in enumerate(target.names):
        nid = target.joint_ids[i]
        p   = target.parent.get(nid)
        if p is None:
            t_parent_world[name] = np.eye(4)
        else:
            # world of parent AT BIND: FK chain with bind locals.
            # bind_world[i] = parent_world_bind @ bind_local[i]  =>  parent = world @ inv(local)
            t_parent_world[name] = target.bind_world[i] @ np.linalg.inv(target.bind_local[i])

    # precompute inverse binds for master
    inv_bind_world_l = {n: np.linalg.inv(master.bind_world[i]) for i, n in enumerate(master.names)}

    # output buffers
    rots = {n: np.zeros((nfr,4)) for n in target.names}
    hips_t_out = np.zeros((nfr,3))

    for fi, t in enumerate(times_out):
        # master FK for this frame
        locals_l = []
        for i, name in enumerate(master.names):
            tr = tracks.get(name, {})
            if 'rotation' in tr:
                q = sample_track(*tr['rotation'], t, True)
            else:
                q = mat2q(master.bind_local[i][:3,:3] / np.linalg.norm(master.bind_local[i][:3,:3], axis=0))
            tt = master.bind_local[i][:3,3].copy()
            if 'translation' in tr:
                tt = sample_track(*tr['translation'], t, False)
            s = np.linalg.norm(master.bind_local[i][:3,:3], axis=0)
            locals_l.append(trs(tt, q, s))
        world_l = master._fk(locals_l)

        for i, name in enumerate(target.names):
            if name not in master.name2jid:
                continue
            mi = master.name2jid[name]
            delta = world_l[mi] @ inv_bind_world_l[name]
            dw = F4 @ delta @ F4inv                      # Z-up world -> Y-up world
            dw[:3,3] = 0.0                                # rotation only
            dw[:3,:3] = dw[:3,:3] / np.linalg.norm(dw[:3,:3], axis=0)
            wt = dw @ target.bind_world[i]
            local = np.linalg.inv(t_parent_world[name]) @ wt
            lr = local[:3,:3] / np.linalg.norm(local[:3,:3], axis=0)
            rots[name][fi] = mat2q(lr)

        # Hips translation: world delta mapped Z-up -> Y-up, then height-scaled
        mi = master.name2jid[hips_l]
        tw = world_l[mi][:3,3]
        dt = (Fm @ (tw - master.bind_world_t[hips_l])) * scale
        out_world = target.bind_world_t[hips_l] + dt
        local = np.linalg.inv(t_parent_world[hips_l]) @ np.append(out_world, 1.0)
        hips_t_out[fi] = local[:3]

    return times_out, rots, hips_t_out

# -------------------------------------------------------------------- main ---

def main():
    master_path, target_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    fps = 30
    if '--fps' in sys.argv:
        fps = int(sys.argv[sys.argv.index('--fps')+1])

    mg, mb = load_glb(master_path)
    tg, tb = load_glb(target_path)
    master = Rig(mg, mb)
    target = Rig(tg, tb)

    shared = [n for n in target.names if n in master.name2jid]
    print(f"master joints: {len(master.names)}, target joints: {len(target.names)}, shared: {len(shared)}")
    assert len(shared) >= 20, 'rigs do not share enough bone names'

    # Build output GLB from the TARGET, replacing its animations.
    og, ob = tg, tb
    # drop existing animations; keep everything else
    og['animations'] = []

    # map: target node index for each joint name
    t_node_of = {target.names[i]: target.joint_ids[i] for i in range(len(target.names))}

    for anim in mg.get('animations', []):
        name = anim.get('name', 'clip')
        times, rots, hips_t = retarget(master, target, anim, fps)
        samplers, channels = [], []
        t_acc = append_accessor(og, ob, times, 'SCALAR')
        for bname in target.names:
            if bname not in master.name2jid: continue
            v_acc = append_accessor(og, ob, rots[bname], 'VEC4')
            samplers.append({'input': t_acc, 'output': v_acc, 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers)-1,
                             'target': {'node': t_node_of[bname], 'path': 'rotation'}})
        # Hips translation
        h_acc = append_accessor(og, ob, hips_t, 'VEC3')
        samplers.append({'input': t_acc, 'output': h_acc, 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers)-1,
                         'target': {'node': t_node_of['Hips'], 'path': 'translation'}})
        og['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})
        print(f"  baked {name}: {len(times)} frames, {len(channels)} channels")

    # fix buffer byteLength
    og['buffers'] = [{'byteLength': len(ob)}]
    save_glb(out_path, og, ob)
    print(f"wrote {out_path}")

if __name__ == '__main__':
    main()
