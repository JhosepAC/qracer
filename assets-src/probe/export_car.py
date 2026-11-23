"""Merge by material, derive LODs and export the original F02 coupe in Blender MCP."""

import json
import math
from pathlib import Path

import bmesh
import bpy


def export(root, source_scene, revision=""):
    root = Path(root)
    source = bpy.data.scenes[source_scene]
    if not source.get("qracer_original"):
        raise RuntimeError("Not a QRacer source scene")
    name = "QRacer_F02_Car_Export" + revision
    if name in bpy.data.scenes:
        raise RuntimeError("Export scene already exists; inspect before rebuilding")
    scene = bpy.data.scenes.new(name)
    collection = scene.collection
    mats = []
    bm = bmesh.new()
    for ob in source.objects:
        if ob.type != "MESH":
            continue
        before = len(bm.faces)
        bm.from_mesh(ob.data)
        bm.faces.ensure_lookup_table()
        for face in list(bm.faces)[before:]:
            mat = ob.data.materials[face.material_index]
            if mat not in mats:
                mats.append(mat)
            face.material_index = mats.index(mat)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    base = bpy.data.meshes.new("QR_Coupe_Combined")
    bm.to_mesh(base)
    bm.free()
    for mat in mats:
        base.materials.append(mat)
    report = {
        "source": source_scene,
        "license": "MIT",
        "units": "metres",
        "gltfForward": "-Z",
        "lods": {},
    }
    objects = []
    old = bpy.context.window.scene
    try:
        bpy.context.window.scene = scene
        for level, ratio in enumerate([1.0, 0.42]):
            ob = bpy.data.objects.new("QR_Coupe_LOD" + str(level), base.copy())
            ob["qracer_lod"] = level
            collection.objects.link(ob)
            if level:
                mod = ob.modifiers.new("DistanceLOD", "DECIMATE")
                mod.ratio = ratio
                mod.use_collapse_triangulate = True
                mod.use_symmetry = True
                mod.symmetry_axis = "X"
                bpy.context.view_layer.update()
                dg = bpy.context.evaluated_depsgraph_get()
                evaluated = ob.evaluated_get(dg)
                data = bpy.data.meshes.new_from_object(evaluated, depsgraph=dg)
                ob.modifiers.clear()
                ob.data = data
            # Repack the merged/triangulated result. Materials are uniform PBR,
            # so no image sampling depends on the source's independent UV layouts.
            uv = ob.data.uv_layers.active
            grid = math.ceil(math.sqrt(len(ob.data.polygons)))
            for face in ob.data.polygons:
                for loop, coord in zip(
                    face.loop_indices, [(0.05, 0.05), (0.95, 0.05), (0.05, 0.95)]
                ):
                    uv.data[loop].uv = (
                        (face.index % grid + coord[0]) / grid,
                        (face.index // grid + coord[1]) / grid,
                    )
            objects.append(ob)
            report["lods"][str(level)] = {
                "triangles": sum(len(p.vertices) - 2 for p in ob.data.polygons),
                "materials": len(ob.data.materials),
                "vertices": len(ob.data.vertices),
            }
        bpy.context.view_layer.update()
        report["dimensionsBlender"] = list(objects[0].dimensions)
        target = root / "apps/web/public/assets/probe/coupe.glb"
        target.parent.mkdir(parents=True, exist_ok=True)
        with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
            result = bpy.ops.export_scene.gltf(
                filepath=str(target),
                export_format="GLB",
                use_active_scene=True,
                use_selection=False,
                export_yup=True,
                export_apply=True,
                export_animations=False,
                export_cameras=False,
                export_lights=False,
                export_extras=True,
            )
            if result != {"FINISHED"}:
                raise RuntimeError("glTF export failed")
        report["bytes"] = target.stat().st_size
        if not 0 < report["bytes"] <= 8 * 1024 * 1024:
            raise RuntimeError("Asset size budget failed")
        (root / "assets-src/probe/coupe.metrics.json").write_text(json.dumps(report, indent=2))
        return report
    finally:
        bpy.context.window.scene = old
