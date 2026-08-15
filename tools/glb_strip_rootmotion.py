#!/usr/bin/env python3
"""Strip horizontal root motion from the Hips translation track of every clip in a GLB.

Physics-driven characters must animate in place: the game moves the entity, the
clip supplies gait/bob only. For each animation channel that targets the node
named 'Hips' with path 'translation', the two horizontal local components are
locked to their frame-0 values; the vertical component (bob/fall) is preserved.

The parent chain of Hips is a constant uniform scale (verified: no clip animates
it), so locking local horizontal components is identical to locking world ones.

Usage:
    glb_strip_rootmotion.py <file.glb> --up z|y [--check]

--up z : Z-up file (animation-library.glb)  -> horizontal = local X, Y ; vertical = Z
--up y : Y-up file (nostrich-master.glb)    -> horizontal = local X, Z ; vertical = Y
--check: measure and report drift only, do not write.

The GLB is rebuilt in place (JSON min/max refreshed, mesh/Draco bytes untouched).
"""
import json
import struct
import sys


def load_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:4] != b'glTF':
        raise SystemExit(f'{path}: not a GLB')
    length = struct.unpack('<I', data[8:12])[0]
    off = 12
    json_chunk = None
    bin_chunk = None
    while off < length:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            json_chunk = json.loads(chunk)
        elif ctype == 0x004E4942:
            bin_chunk = bytearray(chunk)
        off += 8 + clen
    if json_chunk is None or bin_chunk is None:
        raise SystemExit(f'{path}: missing JSON or BIN chunk')
    return json_chunk, bin_chunk


def save_glb(path, g, bin_chunk):
    js = json.dumps(g, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    bc = bytes(bin_chunk) + b'\x00' * (-len(bin_chunk) % 4)
    total = 12 + 8 + len(js) + 8 + len(bc)
    with open(path, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(bc), 0x004E4942) + bc)


def accessor_span(g, acc_idx):
    acc = g['accessors'][acc_idx]
    if acc.get('componentType') != 5126 or acc.get('type') != 'VEC3':
        raise SystemExit(f'accessor {acc_idx}: expected float VEC3, got '
                         f"{acc.get('componentType')}/{acc.get('type')}")
    bv = g['bufferViews'][acc['bufferView']]
    stride = bv.get('byteStride', 12)
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return acc, base, stride


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    path = args[0]
    up = args[args.index('--up') + 1] if '--up' in args else None
    check_only = '--check' in args
    if up not in ('z', 'y'):
        raise SystemExit('need --up z|y')
    h_axes = (0, 1) if up == 'z' else (0, 2)   # horizontal local components
    v_axis = 2 if up == 'z' else 1             # vertical local component

    g, bin_chunk = load_glb(path)
    nodes = g['nodes']
    hips = next(i for i, n in enumerate(nodes) if n.get('name') == 'Hips')

    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    root = parent.get(hips)
    rscale = nodes[root].get('scale', [1, 1, 1]) if root is not None else [1, 1, 1]
    print(f'{path}')
    print(f'  Hips node {hips}, parent {root} ({nodes[root].get("name") if root is not None else "-"}) '
          f'scale={rscale} up={up}')

    total_before = total_after = 0.0
    for anim in g.get('animations', []):
        out_idx = None
        for ch in anim['channels']:
            t = ch['target']
            if t.get('node') == hips and t.get('path') == 'translation':
                out_idx = anim['samplers'][ch['sampler']]['output']
                break
        if out_idx is None:
            print(f"  {anim['name']:<26} no Hips translation track")
            continue
        acc, base, stride = accessor_span(g, out_idx)
        n = acc['count']
        vals = []
        for i in range(n):
            o = base + i * stride
            vals.append(list(struct.unpack_from('<fff', bin_chunk, o)))
        s = rscale[0] if rscale else 1.0
        before = [abs(vals[-1][a] - vals[0][a]) * s for a in h_axes]
        drift_before = max(before)
        h0 = [vals[0][a] for a in h_axes]
        if not check_only:
            for i in range(n):
                for k, a in enumerate(h_axes):
                    vals[i][a] = h0[k]
                o = base + i * stride
                struct.pack_into('<fff', bin_chunk, o, *vals[i])
            if 'min' in acc or 'max' in acc:
                for a in range(3):
                    col = [v[a] for v in vals]
                    if 'min' in acc:
                        acc['min'][a] = min(col)
                    if 'max' in acc:
                        acc['max'][a] = max(col)
        after = [abs(vals[-1][a] - vals[0][a]) * s for a in h_axes]
        drift_after = max(after)
        total_before += drift_before
        total_after += drift_after
        v_range = (min(v[v_axis] for v in vals), max(v[v_axis] for v in vals))
        print(f"  {anim['name']:<26} frames={n:<4} horiz drift {drift_before:7.3f}m -> {drift_after:6.3f}m "
              f"vert range [{v_range[0] * s:6.3f},{v_range[1] * s:6.3f}]m")
    print(f'  TOTAL horizontal drift: {total_before:.3f}m -> {total_after:.3f}m')
    if check_only:
        return
    save_glb(path, g, bin_chunk)
    print('  written.')


if __name__ == '__main__':
    main()
