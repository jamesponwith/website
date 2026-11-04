"""Bind the TRELLIS fox to the Khronos fox skeleton and export a rigged GLB.

Usage: blender -b -P rig.py -- <dir> <trellis.glb> <out.glb> [target_tris]
"""
import bpy, bmesh, sys, math, mathutils
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
D, SRC, OUT = argv[0], argv[1], argv[2]
TARGET_TRIS = int(argv[3]) if len(argv) > 3 else 35000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f"{D}/khronos.glb")
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
kmesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=SRC)
fox = next(o for o in bpy.context.scene.objects if o not in before and o.type == "MESH")
for o in [o for o in bpy.context.scene.objects if o not in before and o != fox]:
    bpy.data.objects.remove(o)
bpy.context.view_layer.update()

def world_verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]

# 1. Orient: main horizontal axis (PCA) to -Y, head toward -Y.
vs = world_verts(fox)
n = len(vs)
c = sum(vs, Vector()) / n
sxx = sum((v.x - c.x) ** 2 for v in vs) / n
syy = sum((v.y - c.y) ** 2 for v in vs) / n
sxy = sum((v.x - c.x) * (v.y - c.y) for v in vs) / n
ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
ax = Vector((math.cos(ang), math.sin(ang), 0))
top = sorted(vs, key=lambda v: -v.z)[:200]
if sum((v - c).dot(ax) for v in top) < 0:  # ears (head) should sit on +axis
    ang += math.pi
rot = Matrix.Rotation(-math.pi / 2 - ang, 4, "Z")  # +axis -> -Y
fox.matrix_world = rot @ Matrix.Translation(-c) @ fox.matrix_world
bpy.context.view_layer.update()

# 2. Paw landmarks in the new frame: lowest points, split front/hind by Y.
vs = world_verts(fox)
zmin = min(v.z for v in vs)
low = [v for v in vs if v.z < zmin + 0.035]
ymin_all, ymax_all = min(v.y for v in vs), max(v.y for v in vs)
# The tail tip may touch down behind the hind paws: drop the rearmost low cluster.
low.sort(key=lambda v: v.y)
gaps = [(low[i + 1].y - low[i].y, i) for i in range(len(low) - 1)]
gaps.sort(reverse=True)
cuts = sorted(i for _, i in gaps[:2])
clusters = [low[: cuts[0] + 1], low[cuts[0] + 1 : cuts[1] + 1], low[cuts[1] + 1 :]]
clusters = [cl for cl in clusters if cl]
mid = lambda cl: sum((v for v in cl), Vector()) / len(cl)
front_t, hind_t = mid(clusters[0]), mid(clusters[1])
spread_t = sum((max(v.x for v in cl) - min(v.x for v in cl)) / 4 for cl in clusters[:2]) / 2  # paw centres sit ~a quarter in from each side
print("PAWS front", tuple(round(v, 3) for v in front_t), "hind", tuple(round(v, 3) for v in hind_t), "clusters", [len(cl) for cl in clusters])

# 3. Uniform scale so paw spacing matches the Khronos fox, ground at z=0.
K_FRONT_Y, K_HIND_Y, K_SPREAD = -22.0, 33.0, 7.0
s = (K_HIND_Y - K_FRONT_Y) / (hind_t.y - front_t.y)
mid_t = (front_t + hind_t) / 2
T = Matrix.Translation(Vector((0, (K_FRONT_Y + K_HIND_Y) / 2, 0))) @ Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-mid_t.x, -mid_t.y, -zmin)))
fox.matrix_world = T @ fox.matrix_world
bpy.context.view_layer.update()
bpy.context.view_layer.objects.active = fox
for o in bpy.context.selected_objects: o.select_set(False)
fox.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 3b. The far ear was hidden in the 2D art and came out malformed: replace it
# with a mirror of the good (left) ear across the head's midplane.
def fix_ear(obj, ear_frac=0.17, sink=2.5):
    me = obj.data
    bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    zs = [v.co.z for v in bm.verts]
    zmax, height = max(zs), max(zs) - min(zs)
    base = zmax - ear_frac * height
    tops = sorted(bm.verts, key=lambda v: -v.co.z)[:300]
    # Two ear clusters by a tiny 2-means in XY, seeded by the two farthest tops.
    a = tops[0].co.copy(); b = max(tops, key=lambda v: (v.co - a).xy.length).co.copy()
    for _ in range(8):
        A = [v.co for v in tops if (v.co - a).xy.length <= (v.co - b).xy.length]
        B = [v.co for v in tops if (v.co - a).xy.length > (v.co - b).xy.length]
        a, b = sum(A, Vector()) / len(A), sum(B, Vector()) / len(B)
    m = (a + b) / 2
    n = Vector(((b - a).x, (b - a).y, 0)).normalized()  # midplane normal
    # Forward: toward the nose, the head point farthest from the ears' midpoint.
    head = [v.co for v in bm.verts if v.co.z > zmax - 0.42 * height and (v.co - m).xy.length < 0.45 * height]
    nose = max(head, key=lambda c: abs((c - m).xy.dot(Vector((-n.y, n.x)))))
    fwd = Vector((-n.y, n.x, 0))
    if (nose - m).dot(fwd) < 0: fwd = -fwd
    left = fwd.cross(Vector((0, 0, 1)))  # the fox's left, looking along fwd (Blender is Z-up)
    good_sign = 1 if (a - m).dot(left) > 0 else -1
    good_sign = good_sign if (a - m).dot(n) > 0 else -good_sign  # in terms of n
    side = lambda co: (co - m).dot(n)
    bad = [v for v in bm.verts if v.co.z > base and side(v.co) * good_sign < -0.5]
    good_faces = [f for f in bm.faces if all(v.co.z > base - sink and side(v.co) * good_sign > 0.5 for v in f.verts)]
    bmesh.ops.delete(bm, geom=bad, context="VERTS")
    dup = bmesh.ops.duplicate(bm, geom=good_faces)
    new_verts = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in new_verts:
        d = side(v.co)
        v.co = v.co - 2 * d * n
    bmesh.ops.reverse_faces(bm, faces=[g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)])
    bm.to_mesh(me); bm.free(); me.update()
    print("EAR fixed: removed", len(bad), "verts, mirrored", len(good_faces), "faces; base z", round(base, 1))
fix_ear(fox)

# 4. Fit the skeleton to the new body: vertical scale from back height, lateral from paw spread.
def back_height(o, y0, y1):
    return max(v.z for v in world_verts(o) if y0 < v.y < y1)
back_k = back_height(kmesh, -5, 15)
back_t = back_height(fox, -5, 15)
sz = back_t / back_k
sx = (spread_t * s) / K_SPREAD if spread_t > 1e-6 else 1
sx = max(0.6, min(1.8, sx))
print("SCALE", round(s, 2), "sz", round(sz, 3), "sx", round(sx, 3), "back", round(back_k, 1), round(back_t, 1))
fit = lambda p: Vector((p.x * sx, p.y, p.z * sz))

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
inv = arm.matrix_world.inverted()
for eb in arm.data.edit_bones:
    eb.head = inv @ fit(arm.matrix_world @ eb.head)
    eb.tail = inv @ fit(arm.matrix_world @ eb.tail)
bpy.ops.object.mode_set(mode="OBJECT")

# 5. Lighter mesh, then bind with automatic (heat) weights.
bpy.data.objects.remove(kmesh)
bpy.context.view_layer.objects.active = fox
tris = sum(len(p.vertices) - 2 for p in fox.data.polygons)
dec = fox.modifiers.new("dec", "DECIMATE")
dec.ratio = min(1.0, TARGET_TRIS / tris)
bpy.ops.object.modifier_apply(modifier="dec")
# Weld the seams TRELLIS leaves so heat weighting sees one surface.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.02)
bpy.ops.object.mode_set(mode="OBJECT")
# Heat weighting needs one closed surface: weight a voxel-remeshed proxy,
# then transfer its weights onto the real mesh.
proxy = fox.copy(); proxy.data = fox.data.copy(); bpy.context.scene.collection.objects.link(proxy)
rm = proxy.modifiers.new("rm", "REMESH"); rm.mode = "VOXEL"; rm.voxel_size = 1.2
bpy.context.view_layer.objects.active = proxy
bpy.ops.object.modifier_apply(modifier="rm")
for o in bpy.context.selected_objects: o.select_set(False)
proxy.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
print("PROXY", len(proxy.data.vertices), "verts", sum(1 for v in proxy.data.vertices if v.groups), "weighted")
for g in proxy.vertex_groups: fox.vertex_groups.new(name=g.name)
dt = fox.modifiers.new("dt", "DATA_TRANSFER"); dt.object = proxy
dt.use_vert_data = True; dt.data_types_verts = {"VGROUP_WEIGHTS"}; dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"; dt.layers_vgroup_select_dst = "NAME"
bpy.context.view_layer.objects.active = fox
bpy.ops.object.modifier_apply(modifier="dt")
bpy.data.objects.remove(proxy)

# The mascot's head is turned toward the viewer; turn it back to face along
# the body (-Y) so it looks where it walks. Weighted by head/neck influence.
gi = {g.name: g.index for g in fox.vertex_groups}
def w(v, name):
    return next((g.weight for g in v.groups if g.group == gi.get(name)), 0.0)
neck_b = arm.data.bones["b_Neck_04"]; head_b = arm.data.bones["b_Head_05"]
pivot = arm.matrix_world @ head_b.head_local
head_vs = [v for v in fox.data.vertices if w(v, "b_Head_05") > 0.6]
nose = max(head_vs, key=lambda v: Vector(((v.co - pivot).x, (v.co - pivot).y)).length)
d = nose.co - pivot
yaw = math.atan2(d.x, -d.y)  # 0 when the nose points along -Y
print("HEAD yaw deg", round(math.degrees(yaw), 1), "nose", tuple(round(c, 1) for c in nose.co))
# Turned back at runtime by yawing the spine/neck/head bones (see scene.ts).
# Legs: bone heat follows the rig's odd bone shapes (the paw bones run up the
# front of the shin), so whole shins followed the paws and folded. Re-weight
# each leg by joint height instead, with a short blend at each joint; the top
# of the leg keeps its blend into the body.
CHAINS = {
    "front_r": ["b_RightUpperArm_06", "b_RightForeArm_07", "b_RightHand_08"],
    "front_l": ["b_LeftUpperArm_09", "b_LeftForeArm_010", "b_LeftHand_011"],
    "hind_r": ["b_RightLeg01_019", "b_RightLeg02_020", "b_RightFoot01_021"],  # toe bone left out:
    "hind_l": ["b_LeftLeg01_015", "b_LeftLeg02_016", "b_LeftFoot01_017"],    # paws stay rigid
}
BLEND = 7.0  # a joint bends over this many units, so it curves rather than creases
def joint_z(name):
    return (arm.matrix_world @ arm.data.bones[name].head_local).z
# Which leg a vertex belongs to is decided by where it is (side, front/back),
# not by heat weighting, which mixed up the two hind legs where they sit close.
all_leg = {gi[n] for c in CHAINS.values() for n in c} | {gi["b_RightFoot02_022"], gi["b_LeftFoot02_018"]}
mid_y = (K_FRONT_Y + K_HIND_Y) / 2
def chain_of(co):
    return ("front_" if co.y < mid_y else "hind_") + ("r" if co.x < 0 else "l")
# Each leg is a column from its paw (centre of its ground contact) up to its
# hip or shoulder joint; a vertex is leg only if it sits inside that column.
ground = [v.co for v in fox.data.vertices if v.co.z < 3]
paw = {}
for name in CHAINS:
    pts = [c for c in ground if chain_of(c) == name]
    paw[name] = sum(pts, Vector()) / len(pts) if pts else Vector()
def in_leg(name, co):
    hip = arm.matrix_world @ arm.data.bones[CHAINS[name][0]].head_local
    t = max(0.0, min(1.0, co.z / hip.z))
    axis = paw[name].lerp(hip, t)
    radius = 7 + 7 * t  # slim at the paw, fuller at the thigh
    return (co - axis).xy.length < radius
body_front, body_hind = gi["b_Spine02_03"], gi["b_Hip_01"]
releg = 0
for name, chain in CHAINS.items():
    idx = [gi[n] for n in chain]
    joints = [joint_z(n) for n in chain]  # top to bottom
    top = joints[0]
    for v in fox.data.vertices:
        share = sum(g.weight for g in v.groups if g.group in all_leg)
        total = sum(g.weight for g in v.groups) or 1
        if v.co.z > top - 4 or chain_of(v.co) != name or not any(g.group in all_leg for g in v.groups):
            continue
        if not in_leg(name, v.co):
            # Belly, chest or tail hanging low: follow the body, not the leg.
            for g in list(v.groups):
                if g.group in all_leg:
                    fox.vertex_groups[g.group].remove([v.index])
            if not v.groups:
                fox.vertex_groups[body_front if v.co.y < mid_y else body_hind].add([v.index], 1.0, "REPLACE")
            continue
        # Which segment by height, blending linearly across each joint below the top.
        ws = [0.0] * len(chain)
        k = next((i for i in range(1, len(joints)) if v.co.z >= joints[i]), len(joints)) - 1
        ws[k] = 1.0
        if k + 1 < len(joints):
            d = v.co.z - joints[k + 1]
            if d < BLEND:
                t = 0.5 + 0.5 * d / BLEND
                ws[k], ws[k + 1] = t, 1 - t
        if k > 0:
            d = joints[k] - v.co.z
            if d < BLEND:
                t = 0.5 + 0.5 * d / BLEND
                ws[k], ws[k - 1] = t, 1 - t
        for g in list(v.groups):
            fox.vertex_groups[g.group].remove([v.index])
        for i, w_ in zip(idx, ws):
            if w_ > 0:
                fox.vertex_groups[i].add([v.index], w_, "REPLACE")
        releg += 1
# The tail hangs low just behind the hind paws; heat weighting gave its
# underside to the hind legs, which dragged it into a blade on every stride.
# Anything clearly behind the hind legs belongs to the tail.
leg_idx = {gi[n] for c in CHAINS.values() for n in c}
tails = [gi[n] for n in ("b_Tail01_012", "b_Tail02_013", "b_Tail03_014")]
tail_y = [(arm.matrix_world @ arm.data.bones[n].head_local).y for n in ("b_Tail01_012", "b_Tail02_013", "b_Tail03_014")]
detailed = 0
for v in fox.data.vertices:
    if v.co.y < K_HIND_Y + 9 or not any(g.group in leg_idx for g in v.groups):
        continue
    for g in list(v.groups):
        if g.group in leg_idx:
            fox.vertex_groups[g.group].remove([v.index])
    if not any(g.group in tails for g in v.groups):
        k = min(range(3), key=lambda i: abs(v.co.y - tail_y[i]))
        fox.vertex_groups[tails[k]].add([v.index], 1.0, "REPLACE")
    detailed += 1
print("TAIL freed", detailed, "verts from the legs")
print("LEGS reweighted", releg, "verts; joints", {k: [round(joint_z(n), 1) for n in c] for k, c in CHAINS.items()})

# Keep the head rigid: double the head bone's share wherever it already has a
# real say (ears included), so the turn does not bend the ears.
hi = gi["b_Head_05"]
for v in fox.data.vertices:
    wh = next((g.weight for g in v.groups if g.group == hi), 0.0)
    if wh < 0.15: continue
    boosted = min(1.0, wh * 2)
    rest = sum(g.weight for g in v.groups if g.group != hi)
    for g in v.groups:
        g.weight = boosted if g.group == hi else (g.weight / rest * (1 - boosted) if rest else 0.0)
fox.parent = arm
fox.matrix_parent_inverse = arm.matrix_world.inverted()
am = fox.modifiers.new("Armature", "ARMATURE"); am.object = arm
groups = [g.name for g in fox.vertex_groups]
weighted = sum(1 for v in fox.data.vertices if v.groups)
print("BOUND", len(fox.data.polygons), "faces", len(groups), "groups", weighted, "/", len(fox.data.vertices), "weighted")

# 6. Export with the original clips.
for o in bpy.context.selected_objects: o.select_set(False)
fox.select_set(True); arm.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_animations=True,
                          export_image_format="JPEG", export_jpeg_quality=88, export_yup=True)
print("EXPORTED", OUT)
