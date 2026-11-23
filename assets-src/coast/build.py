"""Original QRacer coast props. Run Blender --background --python build.py."""

import math
from pathlib import Path

import bmesh
import bpy


def build(repository):
    root = Path(repository)
    name = "QRacer_Coast_F06"
    if name in bpy.data.scenes:
        raise RuntimeError(f"{name} already exists")
    scene = bpy.data.scenes.new(name)
    scene.unit_settings.system = "METRIC"

    def material(name, color, roughness=0.65, metal=0, glow=0):
        value = bpy.data.materials.new(name)
        value.diffuse_color = (*color, 1)
        if not value.node_tree:
            value.use_nodes = True
        surface = next(n for n in value.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        surface.inputs["Base Color"].default_value = (*color, 1)
        surface.inputs["Roughness"].default_value = roughness
        surface.inputs["Metallic"].default_value = metal
        surface.inputs["Emission Color"].default_value = (*color, 1)
        surface.inputs["Emission Strength"].default_value = glow
        return value

    sand = material("Bay limestone", (0.46, 0.34, 0.24))
    plaster = material("Ivory stucco", (0.75, 0.66, 0.51), 0.85)
    tile = material("Oxide roof tile", (0.35, 0.105, 0.055), 0.89)
    glass = material("Smoke blue window", (0.037, 0.09, 0.12), 0.24, 0.3)
    steel = material("Patinated steel", (0.18, 0.25, 0.27), 0.3, 0.42)
    light = material("Amber diffuser", (1, 0.63, 0.26), 0.38, glow=3)
    rubber = material("Recycled rubber", (0.043, 0.046, 0.048), 0.97)
    orange = material("Safety vermilion", (0.88, 0.16, 0.023), 0.52)
    white = material("Retroreflective silver", (0.82, 0.79, 0.62), 0.38, glow=0.18)

    def group(key):
        node = bpy.data.objects.new(key, None)
        node["qracer_asset"] = key
        scene.collection.objects.link(node)
        return node

    def hull(parent, label, rings, finish, smooth=False):
        size = len(rings[0])
        vertices = [point for ring in rings for point in ring]
        faces = [tuple(reversed(range(size)))]
        for ring in range(len(rings) - 1):
            for index in range(size):
                a = ring * size + index
                b = ring * size + (index + 1) % size
                faces.append((a, b, b + size, a + size))
        faces.append(tuple(range(len(vertices) - size, len(vertices))))
        mesh = bpy.data.meshes.new(label)
        mesh.from_pydata(vertices, [], faces)
        edit = bmesh.new()
        edit.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(edit, faces=list(edit.faces))
        if size > 4:
            bmesh.ops.triangulate(edit, faces=[face for face in edit.faces if len(face.verts) > 4])
        edit.to_mesh(mesh)
        edit.free()
        mesh.materials.append(finish)
        for face in mesh.polygons:
            face.use_smooth = smooth and abs(face.normal.z) < 0.92
        obj = bpy.data.objects.new(label, mesh)
        scene.collection.objects.link(obj)
        obj.parent = parent
        return obj

    def slab(parent, label, center, dimensions, finish, bevel=0.04):
        x, y, z = center
        w, d, h = (value / 2 for value in dimensions)
        cut = min(bevel, w * 0.65, d * 0.65)
        profile = [
            (-w + cut, -d), (w - cut, -d), (w, -d + cut), (w, d - cut),
            (w - cut, d), (-w + cut, d), (-w, d - cut), (-w, -d + cut),
        ]
        return hull(
            parent, label,
            [[(x + a, y + b, z + level) for a, b in profile] for level in [-h, h]], finish,
        )

    def rounds(parent, label, center, sections, finish, sides=12):
        x, y = center
        return hull(parent, label, [
            [(x + dx + radius * math.cos(i * math.tau / sides),
              y + radius * math.sin(i * math.tau / sides), z) for i in range(sides)]
            for z, dx, radius in sections
        ], finish, True)

    wall = group("seawall")
    # Chamfered wall with individual capstones and recessed drainage channels.
    for index in range(6):
        y = (index - 2.5) * 4
        slab(wall, "Bay wall", (0, y, -0.95), (1.75, 3.98, 1.9), sand, 0.11)
        slab(wall, "Limestone coping", (0.08, y, 0.04), (1.87, 3.97, 0.08), plaster)
        slab(wall, "Drain grille", (0.883, y + 1.24, -0.42), (0.016, 0.32, 0.27), steel)

    villa = group("villa")
    slab(villa, "Terrace plinth", (0, 0, 0.33), (8.5, 7.5, 0.66), sand, 0.35)
    slab(villa, "Lower stucco", (0, 0, 1.82), (7.6, 6.6, 2.3), plaster, 0.2)
    slab(villa, "Upper stucco", (-0.6, 0.35, 4.18), (6.05, 5.4, 2.4), plaster, 0.25)
    for x, y, z, w, d in [(0, 0, 2.97, 8, 7), (-0.6, 0.35, 5.38, 6.5, 5.86)]:
        levels = [(z, w, d), (z + 0.12, w, d), (z + 0.9, w - 1.8, d - 1.8)]
        hull(villa, "Hipped roof", [
            [(x + a * width / 2, y + b * depth / 2, height) for a, b in
             [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
            for height, width, depth in levels
        ], tile)
    for x, y, z, w, d in [(0, 0, 1.9, 7.6, 6.6), (-0.6, 0.35, 4.17, 6.05, 5.4)]:
        for side in [-1, 1]:
            for offset in [-1.75, 0, 1.75]:
                slab(villa, "Recessed glazing", (x + offset, y + side * (d / 2 + 0.025), z),
                     (0.95, 0.05, 1.26), glass)
                slab(villa, "Stone sill", (x + offset, y + side * (d / 2 + 0.07), z - 0.68),
                     (1.13, 0.14, 0.1), sand)
                slab(villa, "Side glazing", (x + side * (w / 2 + 0.025), y + offset, z),
                     (0.05, 0.92, 1.26), glass)
    slab(villa, "Terrace parapet", (0.6, -3.18, 3.42), (5.8, 0.18, 0.6), sand)

    lamp = group("lamp")
    rounds(lamp, "Lamp footing", (0, 0), [(0, 0, 0.24), (0.15, 0, 0.21)], sand)
    rounds(lamp, "Swept pole", (0, 0), [
        (0.15, 0, 0.125), (0.48, 0, 0.095), (3.3, 0, 0.067),
        (3.72, -0.13, 0.062), (4.04, -0.42, 0.055), (4.12, -0.7, 0.052),
    ], steel, 10)
    slab(lamp, "Luminaire shade", (-0.82, 0, 4.14), (0.56, 0.27, 0.11), steel, 0.09)
    slab(lamp, "Luminaire lens", (-0.82, 0, 4.06), (0.42, 0.19, 0.05), light, 0.055)

    cones = group("cones")
    for index, (x, y, size) in enumerate([(-0.52, -0.12, 1), (0, 0.16, 1.1), (0.52, -0.08, 0.92)]):
        cone = bpy.data.objects.new(f"Safety cone {index + 1}", None)
        scene.collection.objects.link(cone)
        cone.parent = cones
        directions = [(math.cos(i * math.tau / 16), math.sin(i * math.tau / 16)) for i in range(16)]
        rings = []
        for height, radius in [(0, None), (0.07, None), (0.07, 0.155), (0.34, 0.106),
                               (0.45, 0.078), (0.62, 0.039)]:
            ring = []
            for a, b in directions:
                edge = 0.19 / max(abs(a), abs(b)) if radius is None else radius
                ring.append((x + a * edge, y + b * edge, height * size))
            rings.append(ring)
        body = hull(cone, "Safety cone", rings, rubber, True)
        body.data.materials.append(orange)
        body.data.materials.append(white)
        for face in body.data.polygons:
            height = face.center.z / size
            if height > 0.0701:
                face.material_index = 2 if 0.34 < height < 0.45 else 1

    barrier = group("barrier")
    for x in [-0.58, 0.58]:
        slab(barrier, "Barrier ballast", (x, 0, 0.047), (0.32, 0.68, 0.094), rubber, 0.08)
        slab(barrier, "Barrier frame", (x, 0, 0.359), (0.12, 0.12, 0.53), steel)
        rounds(barrier, "Hazard beacon", (x, 0), [(0.85, 0, 0.078), (0.98, 0, 0.056)], light)
    slab(barrier, "Panel", (0, 0, 0.735), (1.58, 0.15, 0.23), orange)
    for side in [-1, 1]:
        for x in [-0.6, -0.3, 0, 0.3, 0.6]:
            y = side * 0.074
            stripe = [(x - 0.1, 0.636), (x + 0.014, 0.636), (x + 0.135, 0.834), (x + 0.021, 0.834)]
            hull(barrier, "Diagonal reflective strip", [
                [(a, y + thickness, z) for a, z in stripe] for thickness in [-0.003, 0.003]
            ], white)

    source = root / "assets-src/coast/coast.blend"
    raw = root / "artifacts/f06/coast-props.glb"
    raw.parent.mkdir(parents=True, exist_ok=True)
    previous = bpy.context.window.scene
    try:
        bpy.context.window.scene = scene
        result = bpy.ops.export_scene.gltf(
            filepath=str(raw), export_format="GLB", use_active_scene=True, export_yup=True,
            export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
        )
        if result != {"FINISHED"}:
            raise RuntimeError("GLB export failed")
        bpy.data.libraries.write(str(source), {scene}, fake_user=True)
    finally:
        bpy.context.window.scene = previous
    return {"scene": scene.name, "raw": str(raw), "source": str(source)}


if __name__ == "__main__":
    print(build(Path(__file__).resolve().parents[2]))
