"""Original modular coastal stress kit, authored in Blender MCP; no external media."""

import json
import math
from pathlib import Path

import bmesh
import bpy
import numpy as np


def build(root, revision=""):
    root = Path(root)
    name = "QRacer_F02_Coast" + revision
    if name in bpy.data.scenes:
        raise RuntimeError("Own scene exists; inspect before rebuilding")
    scene = bpy.data.scenes.new(name)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    rng = np.random.default_rng(42)
    assets = {}

    def mat(name, color, rough=0.6, metal=0, emission=0):
        m = bpy.data.materials.new("QR_" + name)
        n = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        n.inputs["Base Color"].default_value = (*color, 1)
        n.inputs["Roughness"].default_value = rough
        n.inputs["Metallic"].default_value = metal
        n.inputs["Emission Color"].default_value = (*color, 1)
        n.inputs["Emission Strength"].default_value = emission
        m.diffuse_color = (*color, 1)
        return m

    asphalt = mat("Asphalt", (0.08, 0.10, 0.11), 0.9)
    concrete = mat("Concrete", (0.48, 0.43, 0.36), 0.85)
    white = mat("RoadPaint", (0.78, 0.8, 0.72), 0.7)
    steel = mat("GuardSteel", (0.22, 0.31, 0.32), 0.35, 0.75)
    bark = mat("Bark", (0.20, 0.105, 0.045), 0.9)
    leaf = mat("PalmLeaf", (0.07, 0.23, 0.14), 0.8)
    rock = mat("CliffStrata", (0.63, 0.32, 0.18), 0.9)
    glazing = mat("TowerGlass", (0.035, 0.13, 0.16), 0.23, 0.6)
    warm = mat("WarmLight", (1, 0.53, 0.17), 0.4, 0, 1.2)

    def group(key):
        node = bpy.data.objects.new("QR_Kit_" + key, None)
        node["qracer_asset"] = key
        scene.collection.objects.link(node)
        assets[key] = []
        return node

    def mesh(key, name, verts, faces, material, parent, smooth=False):
        data = bpy.data.meshes.new("QR_" + name)
        data.from_pydata(verts, [], faces)
        data.materials.append(material)
        bm = bmesh.new()
        bm.from_mesh(data)
        origin = next(iter(bm.verts)).co.copy()
        for v in bm.verts:
            v.co -= origin
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if bm.calc_volume(signed=True) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        for v in bm.verts:
            v.co += origin
        for e in bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle() < math.radians(40)
        bm.to_mesh(data)
        bm.free()
        for p in data.polygons:
            p.use_smooth = smooth
        uv = data.uv_layers.new(name="UVMap")
        grid = math.ceil(math.sqrt(len(data.polygons)))
        for p in data.polygons:
            points = [data.vertices[i].co for i in p.vertices]
            a = (points[1] - points[0]).normalized()
            b = p.normal.cross(a).normalized()
            coords = [((v - points[0]).dot(a), (v - points[0]).dot(b)) for v in points]
            lo = [min(c[i] for c in coords) for i in range(2)]
            hi = [max(c[i] for c in coords) for i in range(2)]
            for loop, c in zip(p.loop_indices, coords):
                uv.data[loop].uv = tuple(
                    (
                        (p.index % grid if i == 0 else p.index // grid)
                        + 0.05
                        + 0.9 * (c[i] - lo[i]) / max(hi[i] - lo[i], 1e-9)
                    )
                    / grid
                    for i in range(2)
                )
        ob = bpy.data.objects.new("QR_" + name, data)
        scene.collection.objects.link(ob)
        ob.parent = parent
        assets[key].append(ob)
        return ob

    def box(key, name, c, size, material, parent):
        verts = [
            (c[0] + x * size[0] / 2, c[1] + y * size[1] / 2, c[2] + z * size[2] / 2)
            for x, y, z in [
                (-1, -1, -1),
                (1, -1, -1),
                (1, 1, -1),
                (-1, 1, -1),
                (-1, -1, 1),
                (1, -1, 1),
                (1, 1, 1),
                (-1, 1, 1),
            ]
        ]
        return mesh(
            key,
            name,
            verts,
            [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)],
            material,
            parent,
        )

    # A repeatable asphalt image with aggregate, repaired seams and tire wear.
    n = 1024
    yy, xx = np.mgrid[0:n, 0:n]
    grain = rng.integers(0, 8, (n, n)) / 255
    wear = 0.016 * np.exp(-(((xx / n - 0.23) / 0.055) ** 2)) + 0.016 * np.exp(
        -(((xx / n - 0.76) / 0.055) ** 2)
    )
    base = np.clip(0.085 + grain - wear, 0, 1)
    for k in range(6):
        crack = np.abs(xx - (k * 173 + 18 * np.sin(yy / 110 + k)) % n) < 1.5
        base[crack] *= 0.58
    pixels = np.ones((n, n, 4), dtype=np.float32)
    pixels[:, :, 0] = base * 0.92
    pixels[:, :, 1] = base
    pixels[:, :, 2] = base * 1.04
    image = bpy.data.images.new("QR_AsphaltAggregate", width=n, height=n)
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    nodes = asphalt.node_tree.nodes
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.extension = "REPEAT"
    asphalt.node_tree.links.new(
        tex.outputs["Color"],
        next(n for n in nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"],
    )

    key = "road"
    parent = group(key)
    road = box(key, "Road24m", (0, 0, -0.10), (13.2, 24, 0.2), asphalt, parent)
    for p in road.data.polygons:
        if p.normal.z > 0.9:
            for loop, vi in zip(p.loop_indices, p.vertices):
                co = road.data.vertices[vi].co
                road.data.uv_layers.active.data[loop].uv = (co.x / 4, co.y / 4)
    for side in [-1, 1]:
        box(key, "Curb", (side * 6.35, 0, 0.05), (0.45, 23.98, 0.25), concrete, parent)
        box(key, "EdgePaint", (side * 5.7, 0, 0.002), (0.12, 23.98, 0.006), white, parent)
        for z in [0.59, 0.83]:
            box(key, "GuardBeam", (side * 6.28, 0, z), (0.16, 24, 0.13), steel, parent)
        for y in range(-11, 12, 2):
            box(key, "GuardPost", (side * 6.35, y, 0.49), (0.12, 0.14, 0.95), steel, parent)
    for x in [-2.8, 0, 2.8]:
        for y in [-9, -3, 3, 9]:
            box(key, "LaneDash", (x, y, 0.002), (0.12, 3, 0.006), white, parent)

    key = "palm"
    parent = group(key)
    verts = []
    faces = []
    for j in range(17):
        z = j * 5.2 / 16
        cx = 0.018 * z * z
        radius = (0.16 - 0.011 * z) * (1 + 0.045 * math.sin(j * math.pi / 2))
        for i in range(12):
            a = i * 2 * math.pi / 12
            verts.append((cx + radius * math.cos(a), radius * math.sin(a), z))
        if j:
            for i in range(12):
                faces.append(
                    (
                        (j - 1) * 12 + i,
                        (j - 1) * 12 + (i + 1) % 12,
                        j * 12 + (i + 1) % 12,
                        j * 12 + i,
                    )
                )
    faces.extend([tuple(range(11, -1, -1)), tuple(192 + i for i in range(12))])
    mesh(key, "PalmTrunk", verts, faces, bark, parent, True)
    verts = []
    faces = []
    for frond in range(11):
        a = frond * 2 * math.pi / 11
        start = len(verts)
        for j in range(15):
            t = j / 14
            length = 2.1 + 0.45 * math.sin(frond * 2.4)
            width = max(0.025, math.sin(t * math.pi) ** 0.6 * 0.32 * (1 if j % 2 else 0.64))
            x = 0.018 * 5.2**2 + math.cos(a) * t * length
            y = math.sin(a) * t * length
            z = 5.2 + math.sin(t * math.pi) * 0.7 - t * t * 1.15
            verts.extend(
                [
                    (x - math.sin(a) * width, y + math.cos(a) * width, z),
                    (x, y, z + 0.045),
                    (x + math.sin(a) * width, y - math.cos(a) * width, z),
                ]
            )
            if j:
                b = start + (j - 1) * 3
                c = start + j * 3
                faces.extend([(b, c, c + 1, b + 1), (b + 1, c + 1, c + 2, b + 2)])
        faces.extend([(start, start + 1, start + 2), (start + 42, start + 44, start + 43)])
    mesh(key, "PalmFronds", verts, faces, leaf, parent)

    key = "cliff"
    parent = group(key)
    verts = []
    faces = []
    for j in range(25):
        t = j / 24
        z = t * 15
        for i in range(64):
            a = i * 2 * math.pi / 64
            r = (1 - 0.67 * t) * (
                1 + 0.14 * math.sin(a * 5 + t * 7) + 0.08 * math.sin(a * 11 - t * 13)
            )
            r *= 1 + 0.04 * math.cos(t * math.pi * 18)
            verts.append((math.cos(a) * r * 6, math.sin(a) * r * 4, z))
        if j:
            for i in range(64):
                faces.append(
                    (
                        (j - 1) * 64 + i,
                        (j - 1) * 64 + (i + 1) % 64,
                        j * 64 + (i + 1) % 64,
                        j * 64 + i,
                    )
                )
    faces.extend([tuple(range(63, -1, -1)), tuple(1536 + i for i in range(64))])
    cliff = mesh(key, "ErodedCliff", verts, faces, rock, parent)
    color = cliff.data.color_attributes.new(name="Strata", type="FLOAT_COLOR", domain="CORNER")
    for p in cliff.data.polygons:
        for loop, vi in zip(p.loop_indices, p.vertices):
            v = cliff.data.vertices[vi].co
            band = 0.8 + 0.15 * math.sin(v.z * 2.6 + 0.25 * math.sin(v.x))
            color.data[loop].color = (0.65 * band, 0.36 * band, 0.22 * band, 1)
    node = rock.node_tree.nodes.new("ShaderNodeVertexColor")
    node.layer_name = "Strata"
    rock.node_tree.links.new(
        node.outputs["Color"],
        next(n for n in rock.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"],
    )

    key = "tower"
    parent = group(key)
    box(key, "TowerCore", (0, 0, 13), (8, 7, 26), concrete, parent)
    box(key, "Setback", (0, 0, 27.2), (6.8, 5.8, 2.5), concrete, parent)
    for row in range(9):
        z = 1.5 + row * 2.7
        box(key, "FacadeBelt", (0, 0, z - 1.05), (8.15, 7.15, 0.15), steel, parent)
        for side in [-1, 1]:
            for col in range(5):
                material = warm if (row + col * 3) % 7 == 0 else glazing
                box(
                    key,
                    "WindowFront",
                    (-3.2 + col * 1.6, side * 3.51, z),
                    (1.22, 0.06, 1.85),
                    material,
                    parent,
                )
                box(
                    key,
                    "WindowSide",
                    (side * 4.01, -2.7 + col * 1.35, z),
                    (0.06, 0.95, 1.85),
                    material,
                    parent,
                )
    for x in [-3.5, 3.5]:
        for y in [-3, 3]:
            box(key, "RoofPlant", (x * 0.55, y * 0.55, 28.8), (1.3, 0.9, 0.7), steel, parent)

    old = bpy.context.window.scene
    try:
        bpy.context.window.scene = scene
        target = root / "apps/web/public/assets/probe/coast.glb"
        target.parent.mkdir(parents=True, exist_ok=True)
        result = bpy.ops.export_scene.gltf(
            filepath=str(target),
            export_format="GLB",
            use_active_scene=True,
            export_yup=True,
            export_apply=True,
            export_animations=False,
            export_cameras=False,
            export_lights=False,
            export_extras=True,
        )
        if result != {"FINISHED"}:
            raise RuntimeError("Export failed")
        bpy.data.libraries.write(
            str(root / "assets-src/probe/coast.blend"), {scene}, fake_user=True
        )
        report = {
            "scene": scene.name,
            "license": "MIT",
            "bytes": target.stat().st_size,
            "assets": {
                key: {
                    "objects": len(obs),
                    "triangles": sum(
                        sum(len(p.vertices) - 2 for p in o.data.polygons) for o in obs
                    ),
                }
                for key, obs in assets.items()
            },
        }
        (root / "assets-src/probe/coast.metrics.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
        return {
            "scene": scene.name,
            "bytes": report["bytes"],
            "triangles": {k: v["triangles"] for k, v in report["assets"].items()},
        }
    finally:
        bpy.context.window.scene = old
