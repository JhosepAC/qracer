"""Pack original GLBs with glTF Transform 4.5.1 and a local Basis Universal CLI."""

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "apps/web/public/assets/probe"
TARGET = ROOT / "apps/web/public/assets/coast"


def main(encoder):
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise SystemExit("pnpm is required")

    def gltf(*args):
        subprocess.run([pnpm, "dlx", "@gltf-transform/cli@4.5.1", *args], check=True)

    TARGET.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="qracer-coast-") as temporary:
        stage = Path(temporary)
        document = stage / "coast.gltf"
        gltf("copy", PROBE / "coast.glb", document)
        data = json.loads(document.read_text(encoding="utf-8"))
        image, = data["images"]
        texture, = data["textures"]
        extension = "KHR_texture_basisu"
        compressed = stage / "asphalt.ktx2"
        subprocess.run([
            encoder, "-ktx2", "-mipmap", "-q", "180", "-output_file",
            compressed, stage / image["uri"],
        ], check=True)
        image.update(uri=compressed.name, mimeType="image/ktx2")
        texture.setdefault("extensions", {})[extension] = {"source": texture.pop("source")}
        for key in ("extensionsUsed", "extensionsRequired"):
            data.setdefault(key, []).append(extension)
        document.write_text(json.dumps(data), encoding="utf-8")
        for name, source in (
            ("coupe", PROBE / "coupe.glb"),
            ("coast", document),
            ("props", ROOT / "artifacts/f06/coast-props.glb"),
        ):
            gltf("meshopt", source, stage / f"{name}.glb")
        products = [stage / name for name in ("coupe.glb", "coast.glb", "props.glb")]
        report = {}
        for model in products:
            content = model.read_bytes()
            report[model.name] = {
                "bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
            (TARGET / model.name).write_bytes(content)
        (TARGET / "manifest.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n"
        )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python assets-src/coast/pack.py <basisu executable>")
    main(sys.argv[1])
