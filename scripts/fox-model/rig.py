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
