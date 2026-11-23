# Coastal circuit production assets

The coupe and the original road kit are QRacer models from [the Blender
laboratory](../probe). The browser uses the packed editions under
`apps/web/public/assets/coast`. The F02 laboratory retains its original assets
for comparison.

The original F06 props are in `coast.blend`. The independent Blender scene
contains the seawall, villa, lamp, three safety cones and a striped work barrier.
Run `build(repository_path)` from `build.py` in Blender MCP, or run
`blender --background --factory-startup --python assets-src/coast/build.py`
from the repository root. The modeler produces the editable Blender library and
an uncompressed staging GLB. Then run `python assets-src/coast/pack.py /path/to/basisu`.
The packer uses glTF Transform 4.5.1 and was verified with Basis Universal
1.16.3. The road image is 1024² sRGB with 11 mip levels, encoded as ETC1S.
The packed files retain the LOD and module metadata and have a size/hash manifest.

Three.js supplies both decoders. The application serves the JS and WASM
transcoder locally and includes its Apache-2.0 notice in the distribution.
The QRacer models and asphalt image are MIT under the project license.

The F06 props were exported in Blender 5.3.0 through MCP. Material and wireframe
sheets were inspected in front, side, top and three-quarter views. The game mesh
checks passed. Contact warnings at the mounting faces are intentional. The
seawall's foundation sits below the placement plane and the props use solid PBR
materials, so they require no UV maps.
