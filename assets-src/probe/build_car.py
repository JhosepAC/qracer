"""Original QRacer F02 coupe. Run in Blender 5.3 through the existing MCP.

Mid-poly parametric source, metres, front +Y / glTF -Z. No downloaded assets.
Creates a separate scene; never resets or deletes the user's scene.
"""

import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


def build(root, revision=""):
    root = Path(root)
    name = "QRacer_F02_Car" + revision
    if name in bpy.data.scenes:
        raise RuntimeError("Own scene already exists: inspect it before rebuilding")
    scene = bpy.data.scenes.new(name)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    collection = bpy.data.collections.new("QR_Car_Editable")
    scene.collection.children.link(collection)
    source = []

    def material(name, color, metal=0, rough=0.4, emission=0):
        mat = bpy.data.materials.new("QR_" + name)
        node = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        node.inputs["Base Color"].default_value = (*color, 1)
        node.inputs["Metallic"].default_value = metal
        node.inputs["Roughness"].default_value = rough
        if name == "Paint":
            node.inputs["Coat Weight"].default_value = 0.65
            node.inputs["Coat Roughness"].default_value = 0.2
        if emission:
            node.inputs["Emission Color"].default_value = (*color, 1)
            node.inputs["Emission Strength"].default_value = emission
        mat.diffuse_color = (*color, 1)
        return mat

    paint = material("Paint", (0.96, 0.48, 0.022), 0.55, 0.26)
    glass = material("Glass", (0.022, 0.065, 0.085), 0.7, 0.13)
    rubber = material("Rubber", (0.013, 0.018, 0.022), 0, 0.85)
    carbon = material("Carbon", (0.025, 0.035, 0.04), 0.25, 0.4)
    metal = material("Alloy", (0.5, 0.57, 0.6), 0.9, 0.23)
    brake = material("Caliper", (0.65, 0.035, 0.018), 0.4, 0.35)
    white = material("LED", (0.7, 0.93, 1), 0.1, 0.25, 3)
    red = material("RearLED", (1, 0.018, 0.005), 0, 0.25, 2)

    def mesh(name, verts, faces, mat, smooth=False):
        data = bpy.data.meshes.new("QR_" + name)
        data.from_pydata(verts, [], faces)
        data.materials.append(mat)
        bm = bmesh.new()
        bm.from_mesh(data)
        origin = next(iter(bm.verts)).co.copy()
        for v in bm.verts:
            v.co -= origin
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if bm.calc_volume(signed=True) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        for edge in bm.edges:
            if len(edge.link_faces) == 2:
                edge.smooth = edge.calc_face_angle() < math.radians(42)
        for v in bm.verts:
            v.co += origin
        bm.to_mesh(data)
        bm.free()
        for face in data.polygons:
            face.use_smooth = smooth
        ob = bpy.data.objects.new("QR_" + name, data)
        collection.objects.link(ob)
        source.append(ob)
        return ob

    def box(name, center, size, mat, bevel=0.01, rotation=None):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        transform = Matrix.Translation(Vector(center))
        if rotation is not None:
            transform @= rotation.to_matrix().to_4x4()
        for v in bm.verts:
            v.co = transform @ Vector(tuple(v.co[i] * size[i] for i in range(3)))
        if bevel:
            bmesh.ops.bevel(
                bm,
                geom=bm.edges[:],
                offset=min(bevel, min(size) * 0.18),
                segments=2,
                affect="EDGES",
                clamp_overlap=True,
            )
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        data = bpy.data.meshes.new("QR_" + name)
        bm.to_mesh(data)
        bm.free()
        return mesh(
            name,
            [tuple(v.co) for v in data.vertices],
            [tuple(p.vertices) for p in data.polygons],
            mat,
        )

    def beam(name, start, end, width, depth, mat, bevel=0.006):
        a, b = Vector(start), Vector(end)
        return box(
            name,
            (a + b) / 2,
            (width, depth, (b - a).length),
            mat,
            bevel,
            Vector((0, 0, 1)).rotation_difference((b - a).normalized()),
        )

    def ring(name, cx, cy, cz, profile, mat, segments=48):
        verts, faces = [], []
        n = len(profile)
        for i in range(segments):
            a = 2 * math.pi * i / segments
            for x, radius in profile:
                if mat == rubber and radius >= 0.4:
                    radius += 0.003 * (1 if i % 2 == 0 else -1)
                verts.append((cx + x, cy + radius * math.sin(a), cz + radius * math.cos(a)))
        for i in range(segments):
            for j in range(n):
                a, b = i * n + j, ((i + 1) % segments) * n + j
                faces.append((a, b, ((i + 1) % segments) * n + (j + 1) % n, i * n + (j + 1) % n))
        return mesh(name, verts, faces, mat, True)

    # Cross sections follow a shaped shoulder, hood and real wheel openings.
    verts, faces = [], []
    stations = 65
    for i in range(stations):
        y = -2.25 + i * 4.5 / (stations - 1)
        taper = 1 - 0.19 * (abs(y) / 2.25) ** 4
        arch = max(math.sqrt(max(0, 0.47**2 - (y - wheel) ** 2)) for wheel in [-1.35, 1.35])
        lower = max(0.27, 0.42 + arch) if arch else 0.27
        shoulder = max(0.73, lower + 0.065)
        crown = 0.90 - 0.23 * (abs(y) / 2.25) ** 5
        section = [
            (-0.68, 0.27),
            (-0.98, lower),
            (-1.015, shoulder),
            (-0.87, max(crown, shoulder + 0.025)),
            (-0.53, crown + 0.025),
            (0, crown + 0.038),
            (0.53, crown + 0.025),
            (0.87, max(crown, shoulder + 0.025)),
            (1.015, shoulder),
            (0.98, lower),
            (0.68, 0.27),
        ]
        verts.extend((x * taper, y, z) for x, z in section)
        if i:
            for j in range(11):
                a = (i - 1) * 11 + j
                faces.append((a, (i - 1) * 11 + (j + 1) % 11, i * 11 + (j + 1) % 11, i * 11 + j))
    faces.extend([tuple(range(10, -1, -1)), tuple((stations - 1) * 11 + j for j in range(11))])
    mesh("SculptedBody", verts, faces, paint, True)

    # Glazing and roof have independent silhouettes; pillars physically join the shell.
    cabin, cabin_faces = [], []
    sections = [
        (-1.22, 0.89, 0.79, 0.83, 0.84),
        (-0.97, 1.15, 0.65, 0.87, 0.86),
        (-0.65, 1.35, 0.62, 0.89, 0.86),
        (-0.35, 1.41, 0.63, 0.90, 0.86),
        (0.05, 1.42, 0.64, 0.90, 0.86),
        (0.30, 1.38, 0.65, 0.90, 0.85),
        (0.60, 1.20, 0.73, 0.89, 0.85),
        (1.00, 0.90, 0.84, 0.86, 0.84),
    ]
    for i, (y, top, tw, bottom, bw) in enumerate(sections):
        cabin.extend(
            (x, y, z)
            for x, z in [
                (-bw, bottom),
                (-tw, top - 0.06),
                (-tw * 0.75, top - 0.005),
                (0, top + 0.01),
                (tw * 0.75, top - 0.005),
                (tw, top - 0.06),
                (bw, bottom),
            ]
        )
        if i:
            for j in range(7):
                cabin_faces.append(
                    ((i - 1) * 7 + j, (i - 1) * 7 + (j + 1) % 7, i * 7 + (j + 1) % 7, i * 7 + j)
                )
    cabin_faces.extend([tuple(range(6, -1, -1)), tuple(49 + j for j in range(7))])
    canopy = mesh("Glazing", cabin, cabin_faces, glass, True)
    canopy.data.materials.append(paint)
    for face in canopy.data.polygons:
        if -0.67 < face.center.y < 0.32 and face.normal.z > 0.65:
            face.material_index = 1
    for side in [-1, 1]:
        beam("APillar", (side * 0.86, 0.96, 0.86), (side * 0.65, 0.28, 1.40), 0.052, 0.055, paint)
        beam("CPillar", (side * 0.86, -1.15, 0.86), (side * 0.63, -0.67, 1.38), 0.09, 0.08, paint)
        beam("BTrim", (side * 0.855, -0.28, 0.87), (side * 0.645, -0.28, 1.4), 0.035, 0.04, carbon)
        box("SideSkirt", (side * 0.98, 0, 0.275), (0.10, 2.0, 0.12), carbon, 0.02)
        box("Handle", (side * 0.974, -0.30, 0.79), (0.025, 0.19, 0.034), carbon, 0.008)
        beam(
            "MirrorStalk", (side * 0.80, 0.62, 0.86), (side * 1.12, 0.62, 1.0), 0.045, 0.06, carbon
        )
        mirror = box("Mirror", (side * 1.16, 0.62, 1.015), (0.28, 0.21, 0.13), paint, 0.045)
        mirror.data.materials.append(glass)
        for face in mirror.data.polygons:
            if face.normal.y < -0.99:
                face.material_index = 1
        # Separate vent louvers and shoulder intake, not a solid painted rectangle.
        box("Intake", (side * 1.008, -0.83, 0.69), (0.04, 0.37, 0.19), carbon, 0.018)
        for j in range(4):
            box(
                "IntakeFin",
                (side * 1.032, -0.95 + j * 0.08, 0.69),
                (0.04, 0.018, 0.14),
                metal,
                0.004,
            )
        box("HeadlightBed", (side * 0.61, 2.24, 0.62), (0.58, 0.10, 0.115), carbon, 0.018)
        for j in range(2):
            box(
                "Headlight",
                (side * 0.61, 2.295, 0.60 + j * 0.045),
                (0.48, 0.025, 0.018),
                white,
                0.003,
            )
        box("RearLight", (side * 0.58, -2.254, 0.73), (0.66, 0.035, 0.045), red, 0.012)
        box("SpoilerMount", (side * 0.66, -1.91, 0.96), (0.065, 0.13, 0.28), carbon, 0.01)
    box("Wing", (0, -1.95, 1.10), (2.04, 0.29, 0.07), carbon, 0.023)
    box("Splitter", (0, 2.06, 0.245), (1.96, 0.49, 0.09), carbon, 0.025)
    box("Diffuser", (0, -2.11, 0.27), (1.88, 0.37, 0.13), carbon, 0.02)
    for x in [-0.7, -0.35, 0, 0.35, 0.7]:
        box("DiffuserFin", (x, -2.22, 0.27), (0.025, 0.32, 0.20), carbon, 0.007)
    box("Grille", (0, 2.255, 0.43), (1.45, 0.055, 0.23), carbon, 0.04)
    for x in range(-10, 11):
        box("GrilleSlat", (x * 0.063, 2.291, 0.43), (0.015, 0.02, 0.16), metal, 0.003)

    for side in [-1, 1]:
        for y in [-1.35, 1.35]:
            x = side * 0.96
            ring(
                "Tire",
                x,
                y,
                0.42,
                [
                    (-0.17, 0.29),
                    (-0.17, 0.36),
                    (-0.13, 0.405),
                    (-0.08, 0.42),
                    (-0.04, 0.42),
                    (-0.03, 0.414),
                    (-0.02, 0.42),
                    (0.02, 0.42),
                    (0.03, 0.414),
                    (0.04, 0.42),
                    (0.08, 0.42),
                    (0.13, 0.405),
                    (0.17, 0.36),
                    (0.17, 0.29),
                ],
                rubber,
            )
            rim_x = x + side * 0.15
            ring(
                "Rim",
                rim_x,
                y,
                0.42,
                [(-0.03, 0.245), (-0.03, 0.30), (0.03, 0.30), (0.03, 0.245)],
                metal,
                32,
            )
            ring(
                "Disc",
                x + side * 0.09,
                y,
                0.42,
                [(-0.015, 0.06), (-0.015, 0.245), (0.015, 0.245), (0.015, 0.06)],
                metal,
                32,
            )
            ring(
                "Hub",
                rim_x,
                y,
                0.42,
                [(-0.04, 0.03), (-0.04, 0.115), (0.04, 0.115), (0.04, 0.03)],
                metal,
                24,
            )
            ring(
                "Axle",
                side * 0.63,
                y,
                0.42,
                [(-0.37, 0.065), (0.37, 0.065), (0.37, 0.03), (-0.37, 0.03)],
                carbon,
                16,
            )
            for j in range(5):
                a = j * 2 * math.pi / 5
                beam(
                    "Spoke",
                    (rim_x, y + 0.10 * math.sin(a), 0.42 + 0.10 * math.cos(a)),
                    (rim_x, y + 0.27 * math.sin(a + 0.15), 0.42 + 0.27 * math.cos(a + 0.15)),
                    0.04,
                    0.04,
                    metal,
                    bevel=0,
                )
            box("Caliper", (x + side * 0.07, y + 0.18, 0.44), (0.08, 0.13, 0.22), brake, 0.02)

    # Ground the tread's outermost surface, not just the mathematical tire circle.
    lowest = min(v.co.z for ob in source for v in ob.data.vertices)
    for ob in source:
        for v in ob.data.vertices:
            v.co.z -= lowest
    # Pack each planar face into a unique UV cell; uniform materials require no images.
    for ob in source:
        data = ob.data
        uv = data.uv_layers.new(name="UVMap")
        grid = math.ceil(math.sqrt(len(data.polygons)))
        for face in data.polygons:
            points = [data.vertices[i].co for i in face.vertices]
            tangent = (points[1] - points[0]).normalized()
            bitangent = face.normal.cross(tangent).normalized()
            coords = [
                ((p - points[0]).dot(tangent), (p - points[0]).dot(bitangent)) for p in points
            ]
            lo = [min(p[i] for p in coords) for i in range(2)]
            hi = [max(p[i] for p in coords) for i in range(2)]
            for loop, p in zip(face.loop_indices, coords):
                uv.data[loop].uv = tuple(
                    (
                        (face.index % grid if i == 0 else face.index // grid)
                        + 0.05
                        + 0.9 * (p[i] - lo[i]) / max(hi[i] - lo[i], 1e-9)
                    )
                    / grid
                    for i in range(2)
                )
    scene["qracer_original"] = True
    root.joinpath("assets-src/probe").mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(root / "assets-src/probe/coupe.blend"), {scene}, fake_user=True)
    return {
        "scene": scene.name,
        "objects": len(source),
        "materials": 8,
        "triangles": sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in source),
    }


if __name__ == "__main__":
    print(json.dumps(build(Path(__file__).resolve().parents[2])))
