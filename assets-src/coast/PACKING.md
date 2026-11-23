# Coastal circuit production assets

The coupe and the original road kit are QRacer models from [the Blender
laboratory](../probe). The browser uses the packed editions under
`apps/web/public/assets/coast`. The F02 laboratory retains its original assets
for comparison.

Run `python assets-src/coast/pack.py /path/to/basisu` from the repository root.
The packer uses glTF Transform 4.5.1 and was verified with Basis Universal
1.16.3. The road image is 1024² sRGB with 11 mip levels, encoded as ETC1S.
The packed files retain the LOD and module metadata and have a size/hash manifest.

Three.js supplies both decoders. The application serves the JS and WASM
transcoder locally and includes its Apache-2.0 notice in the distribution.
The QRacer models and asphalt image are MIT under the project license.
