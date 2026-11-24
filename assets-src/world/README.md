# F08 original world kit

Original QRacer work authored in Blender 5.3 through MCP. License: repository MIT.
No paid generators, external meshes or textures are required.

`world.blend` contains a layered sandstone mesa, fluted cactus, vaulted short
road gallery, bridge structure, setback arcology with glazing/fins/roof plant,
and sedan/van traffic with two LODs. The existing coupe supplies the third silhouette.
Cars use a common collision footprint; model detail does not change gameplay.

## Reproduction

Open a separate Blender scene and call `build.build(repository)` from `build.py`
via Blender MCP. It preserves existing user scenes and exports editable source
plus `artifacts/f08/{traffic,desert,city}.glb`. Then run:

```sh
python assets-src/world/pack.py
```

The packer pins glTF Transform 4.5.1 and creates Meshopt GLBs plus SHA-256/provenance
manifest in `apps/web/public/assets/world/`. The installed project decoder handles
Meshopt; no remote decoder is needed at runtime. Solid PBR materials have no image
texture requirement; the road retains its existing KTX2 asphalt.

## QA

All nine groups passed blender-asset-qa game checks. `metrics.json` records triangle
counts and warnings. Multi-angle material/wireframe review sheets are recorded
locally in `docs/evidence/f08-blender-{material,wire}.png`.

Accepted warnings: UV stacking is intentional for image-free solid PBR and is not
a bake-ready UV layout. Hidden touching faces are interfaces between glazing,
frames and bodywork; enclosed car parts are intentional. The bridge foundations
extend below road height. There are no accepted z-fighting, floating-part,
non-manifold or inconsistent-normal errors. Re-run QA after geometry changes.
