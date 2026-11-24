"""Original F08 world and traffic kit. Execute build(repository) through Blender MCP."""
import math
from pathlib import Path
import bpy
import bmesh


def build(repository):
    root = Path(repository)
    name = "QRacer_World_F08"
    if name in bpy.data.scenes:
        raise RuntimeError("Use a fresh task scene; source already exists")
    scene = bpy.data.scenes.new(name)
    scene.unit_settings.system = "METRIC"

    def mat(label, color, rough=0.6, metal=0, glow=0):
        value = bpy.data.materials.new(label)
        value.diffuse_color = (*color, 1)
        surface = next(n for n in value.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        for key, data in [("Base Color", (*color, 1)), ("Roughness", rough),
                          ("Metallic", metal), ("Emission Color", (*color, 1)),
                          ("Emission Strength", glow)]:
            surface.inputs[key].default_value = data
        return value

    stone = mat("Terraced sandstone", (0.49, 0.22, 0.10), 0.94)
    strata = mat("Sandstone pale strata", (0.74, 0.44, 0.24), 0.87)
    green = mat("Cactus wax", (0.14, 0.25, 0.18), 0.7)
    concrete = mat("Architectural concrete", (0.045, 0.075, 0.105), 0.76)
    steel = mat("Graphite anodized frames", (0.045, 0.065, 0.085), 0.33, 0.65)
    windows = mat("Warm occupied windows", (0.22, 0.48, 0.62), 0.24, 0.25, 0.9)
    paint = mat("Traffic Paint", (0.4, 0.45, 0.55), 0.24, 0.48)
    glass = mat("Traffic glass", (0.022, 0.055, 0.073), 0.15, 0.45)
    rubber = mat("Tire compound", (0.02, 0.023, 0.028), 0.93)
    alloy = mat("Brushed wheel alloy", (0.42, 0.47, 0.52), 0.26, 0.85)
    rear = mat("Ruby rear optics", (0.8, 0.025, 0.012), 0.3, 0, 2.2)
    front = mat("Ivory front optics", (0.95, 0.85, 0.59), 0.25, 0, 1.2)

    def group(key, lod=None):
        node = bpy.data.objects.new(key, None)
        node["qracer_asset"] = key
        if lod is not None:
            node["qracer_lod"] = lod
        scene.collection.objects.link(node)
        return node

    def mesh(parent, label, vertices, faces, finish, smooth=False):
        data = bpy.data.meshes.new(label)
        data.from_pydata(vertices, [], faces)
        edit = bmesh.new()
        edit.from_mesh(data)
        bmesh.ops.recalc_face_normals(edit, faces=list(edit.faces))
        bmesh.ops.triangulate(edit, faces=list(edit.faces))
        edit.to_mesh(data)
        edit.free()
        data.materials.append(finish)
        # Solid PBR uses no image, but retain a planar UV channel for future baking.
        uv = data.uv_layers.new(name="UVMap")
        for face in data.polygons:
            face.use_smooth = smooth
            axis = max(range(3), key=lambda i: abs(face.normal[i]))
            axes = [i for i in range(3) if i != axis]
            for loop in face.loop_indices:
                co = data.vertices[data.loops[loop].vertex_index].co
                uv.data[loop].uv = (co[axes[0]] * 0.1, co[axes[1]] * 0.1)
        obj = bpy.data.objects.new(label, data)
        scene.collection.objects.link(obj)
        obj.parent = parent
        return obj

    def hull(parent, label, rings, finish, smooth=False):
        n = len(rings[0])
        vertices = [v for ring in rings for v in ring]
        faces = [tuple(reversed(range(n))), tuple(range(len(vertices) - n, len(vertices)))]
        for j in range(len(rings) - 1):
            for i in range(n):
                a, b = j * n + i, j * n + (i + 1) % n
                faces.append((a, b, b + n, a + n))
        return mesh(parent, label, vertices, faces, finish, smooth)

    def slab(parent, label, center, size, finish, bevel=0.1):
        x, y, z = center
        w, d, h = [a / 2 for a in size]
        c = min(bevel, w * 0.45, d * 0.45)
        profile = [(-w+c, -d), (w-c, -d), (w, -d+c), (w, d-c),
                   (w-c, d), (-w+c, d), (-w, d-c), (-w, -d+c)]
        return hull(parent, label, [[(x+a, y+b, z+height) for a, b in profile]
                                   for height in [-h, h]], finish)

    mesa = group("mesa")
    rings = []
    for k, (z, radius) in enumerate([(0, 12), (1, 11.8), (3.8, 10.2), (4.1, 10.8),
                                    (6.7, 9.3), (7, 9.8), (11, 7.4), (11.4, 7.7), (14, 6)]):
        rings.append([(math.cos(a) * radius * (1 + 0.12 * math.sin(3*a)) + z*0.15,
                       math.sin(a) * radius * (0.8 + 0.1 * math.cos(5*a)), z)
                      for a in [i * math.tau / 24 for i in range(24)]])
    rock = hull(mesa, "Wind eroded layered mesa", rings, stone)
    rock.data.materials.append(strata)
    for face in rock.data.polygons:
        if 3.7 < face.center.z < 4.2 or 6.6 < face.center.z < 7.2:
            face.material_index = 1

    cactus = group("cactus")
    for x, y, height, radius in [(0, 0, 4.2, 0.38), (-0.64, 0, 2.8, 0.22), (0.58, 0, 3.2, 0.2)]:
        rings = []
        for z, r in [(0, radius), (height-0.3, radius), (height-0.1, radius*0.75), (height, radius*0.2)]:
            rings.append([(x + math.cos(a)*r*(1+0.08*(i%2)), y+math.sin(a)*r, z)
                          for i, a in enumerate([j*math.tau/16 for j in range(16)])])
        hull(cactus, "Fluted cactus stem", rings, green, True)
    slab(cactus, "Left connective arm", (-0.35, 0, 1.4), (0.65, 0.4, 0.4), green, 0.18)
    slab(cactus, "Right connective arm", (0.32, 0, 1.9), (0.6, 0.36, 0.36), green, 0.16)

    portal = group("portal")
    vertices = []
    for y in [-12, 12]:
        for radius in [8, 9.6]:
            vertices += [(math.cos(i*math.pi/20)*radius, y, math.sin(i*math.pi/20)*radius)
                         for i in range(21)]
    faces = []
    for i in range(20):
        faces += [(i, i+1, i+22, i+21), (i+42, i+63, i+64, i+43),
                  (i, i+42, i+43, i+1), (i+21, i+22, i+64, i+63)]
    faces += [(0, 21, 63, 42), (20, 62, 83, 41)]
    mesh(portal, "Short vaulted road gallery", vertices, faces, concrete)
    for y in [-11.8, 11.8]:
        for side in [-1, 1]:
            slab(portal, "Portal rib buttress", (side*9.1, y, 2.38), (1.4, 0.7, 4.6), concrete)
            slab(portal, "Portal amber marker", (side*7.9, y, 1.2), (0.1, 0.5, 0.3), windows, 0.02)

    bridge = group("bridge")
    for side in [-1, 1]:
        slab(bridge, "Parapet deck connector", (side*6.8,0,-0.10), (2,23.8,0.30), concrete)
        slab(bridge, "Bridge parapet", (side*7.3, 0, 0.6), (0.6, 24, 1.2), concrete)
        slab(bridge, "Bridge lower stringer", (side*6, 0, -0.9), (1, 24, 1.4), steel)
        for y in [-8, 8]:
            slab(bridge, "Tapered bridge pier", (side*6, y, -3.5), (1.6, 2.5, 5), concrete)

    tower = group("arcology")
    for index, (z, w, d, h) in enumerate([(2, 18, 16, 4), (12, 12, 12, 16), (24, 9, 10, 8), (30, 7, 7, 4)]):
        slab(tower, "Chamfered setback", (0, 0, z), (w, d, h), concrete, 0.8)
        for axis in [0, 1]:
            across, along = (w, d) if axis == 0 else (d, w)
            for side in [-1, 1]:
                for level in range(int(z-h/2)+1, int(z+h/2), 2):
                    for column in range(-int(along/2)+2, int(along/2)-1, 2):
                        center = (side*(across/2+0.022), column, level) if axis == 0 else (column, side*(across/2+0.022), level)
                        dims = (0.08, 1.25, 0.95) if axis == 0 else (1.25, 0.08, 0.95)
                        x, y, zz = center
                        xx, yy, hh = (v/2 for v in dims)
                        rings = [[(x+a,y+b,zz+c) for a,b in [(-xx,-yy),(xx,-yy),(xx,yy),(-xx,yy)]] for c in [-hh,hh]]
                        hull(tower, "Facade window bay", rings, glass if (column+level+index)%5 == 0 else windows)
                for column in [-along/3, 0, along/3]:
                    center = (side*(across/2+0.12), column, z) if axis == 0 else (column, side*(across/2+0.12), z)
                    dims = (0.23,0.15,h) if axis == 0 else (0.15,0.23,h)
                    slab(tower, "Facade mullion", center, dims, steel, 0.025)
                center = (side*(across/2+0.06),0,z+h/2-0.3) if axis == 0 else (0,side*(across/2+0.06),z+h/2-0.3)
                dims = (0.16,along-1,0.12) if axis == 0 else (along-1,0.16,0.12)
                slab(tower,"Architectural crown light",center,dims,windows,0.03)
    for x in [-2, 2]:
        slab(tower, "Rooftop plant", (x, 0, 33), (2.2, 3.5, 2), steel, 0.2)

    for kind in ["sedan", "van"]:
        for lod in [0, 1]:
            parent = group(kind, lod)
            def body(label, sections, finish):
                return hull(parent, label, [[(-w*0.9, y, lo), (-w, y, lo+0.08), (-w, y, hi-0.08),
                    (-w*0.86, y, hi), (w*0.86, y, hi), (w, y, hi-0.08), (w, y, lo+0.08), (w*0.9, y, lo)]
                    for y, w, lo, hi in sections], finish)
            body("Sculpted lower body", [(-2.05,0.71,0.32,0.69),(-1.6,0.86,0.27,0.81),
                 (0,0.88,0.29,0.86),(1.6,0.86,0.29,0.85),(2.05,0.74,0.35,0.71)], paint)
            height = 1.35 if kind == "sedan" else 1.85
            body("Panoramic canopy", [(-1.05,0.72,0.77,0.95),(-0.5,0.68,0.79,height),
                 (0.85,0.68,0.79,height),(1.55,0.75,0.8,1.03 if kind == "sedan" else 1.7)], glass)
            slab(parent, "Roof rail crown", (0,0.15,height+0.015), (1.3,1.35 if kind == "sedan" else 2,0.065), paint, 0.12)
            for side in [-1,1]:
                slab(parent, "Painted canopy pillar", (side*0.68,0.28,(height+0.82)/2), (0.09,0.12,height-0.78), paint, 0.025)
                slab(parent, "Sill protection", (side*0.87,0,0.4), (0.08,2.7,0.15), steel, 0.02)
                for y in [-0.35,0.8]:
                    slab(parent, "Flush door handle", (side*0.88,y,0.78), (0.04,0.18,0.035), alloy, 0.01)
                for y, finish in [(-1.96,front),(1.96,rear)]:
                    slab(parent, "Segmented lamp housing", (side*0.55,y,0.68), (0.43,0.12,0.12), finish, 0.04)
                for y in [-1.25,1.25]:
                    vertices, faces = [], []
                    segments = 24 if lod == 0 else 12
                    for j in range(6):
                        a = j*math.tau/6
                        for i in range(segments):
                            b = i*math.tau/segments
                            radius = 0.26+0.08*math.cos(a)
                            vertices.append((side*0.78+0.12*math.sin(a), y+math.sin(b)*radius, 0.34+math.cos(b)*radius))
                    for j in range(6):
                        for i in range(segments):
                            faces.append((j*segments+i,j*segments+(i+1)%segments,((j+1)%6)*segments+(i+1)%segments,((j+1)%6)*segments+i))
                    mesh(parent,"Road tire",vertices,faces,rubber,True)
                    rings=[[(side*x, y+math.sin(i*math.tau/segments)*r,0.34+math.cos(i*math.tau/segments)*r)
                            for i in range(segments)] for x,r in [(0.82,0.2),(0.9,0.2),(0.92,0.12)]]
                    hull(parent,"Machined alloy wheel",rings,alloy)
            slab(parent,"Lower bumper grille",(0,-2.02,0.43),(1.05,0.12,0.16),steel,0.035)
            if lod == 0:
                for x in [-0.4,-0.2,0,0.2,0.4]:
                    slab(parent,"Grille louver",(x,-2.09,0.44),(0.025,0.025,0.12),alloy,0.005)

    output = root / "artifacts/f08/world.glb"
    output.parent.mkdir(parents=True, exist_ok=True)
    source = root / "assets-src/world/world.blend"
    previous = bpy.context.window.scene
    try:
        bpy.context.window.scene = scene
        bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_active_scene=True,
            export_extras=True, export_animations=False, export_cameras=False, export_lights=False)
        for key, assets in [("traffic", {"sedan", "van"}), ("desert", {"mesa", "cactus", "portal", "bridge"}),
                            ("city", {"arcology", "portal", "bridge"})]:
            bpy.ops.object.select_all(action="DESELECT")
            for obj in scene.objects:
                parent = obj
                while parent.parent:
                    parent = parent.parent
                obj.select_set(parent.get("qracer_asset") in assets)
            bpy.ops.export_scene.gltf(filepath=str(output.parent / f"{key}.glb"), export_format="GLB",
                use_selection=True, export_extras=True, export_animations=False,
                export_cameras=False, export_lights=False)
        bpy.data.libraries.write(str(source), {scene}, fake_user=True)
    finally:
        bpy.context.window.scene = previous
    return {"scene": name, "source": str(source), "raw": str(output), "objects": len(scene.objects)}
