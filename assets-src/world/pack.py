"""Reproduce F08 Meshopt delivery from original Blender exports (no paid tooling)."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def pack():
    root = Path(__file__).resolve().parents[2]
    target = root / "apps/web/public/assets/world"
    target.mkdir(parents=True, exist_ok=True)
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("pnpm is required")
    report = {}
    for key in ["traffic", "desert", "city"]:
        source = root / f"artifacts/f08/{key}.glb"
        model = target / f"{key}.glb"
        subprocess.run([pnpm, "dlx", "@gltf-transform/cli@4.5.1", "meshopt", str(source), str(model)], check=True)
        data = model.read_bytes()
        report[model.name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "source": "assets-src/world/world.blend", "license": "MIT", "author": "QRacer contributors",
            "pipeline": "Blender 5.3 MCP / glTF Transform 4.5.1 / Meshopt"}
    (target / "manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    pack()
