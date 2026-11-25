import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Comparable collection points: app paused, measurement stopped, two explicit GCs.
export async function checkpoint(page, label) {
  if ((await page.locator("#app").getAttribute("data-mode")) === "playing")
    throw new Error("GC is forbidden during a timed race");
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(50);
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    const dom = await cdp.send("Memory.getDOMCounters");
    const scene = await page.evaluate(() => ({
      renderer: JSON.parse(document.querySelector("#preview").dataset.renderStats || "{}"),
      canvases: document.querySelectorAll("#preview canvas").length,
      at: performance.now(),
    }));
    const result = { label, ...heap, ...dom, ...scene };
    console.log("checkpoint", label, result.usedSize, result.nodes, result.jsEventListeners);
    if (
      result.canvases !== 1 ||
      result.usedSize > 150 * 2 ** 20 ||
      !Number.isFinite(result.renderer.textureBytesEstimate) ||
      result.renderer.textureBytesEstimate > 128 * 2 ** 20
    )
      throw new Error(`Resource budget exceeded at ${label}`);
    return result;
  } finally {
    await cdp.detach();
  }
}

async function heapSnapshot(page, path) {
  const cdp = await page.context().newCDPSession(page);
  const chunks = [];
  cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => chunks.push(chunk));
  try {
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    await writeFile(path, chunks.join(""));
  } finally {
    await cdp.detach();
  }
}

export async function restartAudit(page, output, count = 20) {
  await heapSnapshot(page, resolve(output, "before.heapsnapshot"));
  const restarts = [],
    rebuilds = [];
  for (let i = 1; i <= count; i++) {
    await page.locator("#restart").click();
    await page.keyboard.down("ArrowUp");
    await page.waitForFunction(
      () =>
        JSON.parse(document.querySelector("#preview").dataset.renderStats || "{}").simulationTick >=
        60,
    );
    await page.keyboard.up("ArrowUp");
    await page.keyboard.press("Escape");
    restarts.push(await checkpoint(page, `restart/${i}`));
  }
  // Rebuild real GLB scenes too: ordinary restart intentionally reuses the renderer.
  for (let i = 1; i <= count; i++) {
    await page.locator("#return-menu").click();
    await page.waitForSelector('#preview[data-graphics="ready"]');
    await page.locator("#start").click();
    await page.keyboard.down("ArrowUp");
    await page.waitForFunction(
      () =>
        JSON.parse(document.querySelector("#preview").dataset.renderStats || "{}").simulationTick >=
        60,
    );
    await page.keyboard.up("ArrowUp");
    await page.keyboard.press("Escape");
    rebuilds.push(await checkpoint(page, `rebuild/${i}`));
  }
  await heapSnapshot(page, resolve(output, "after.heapsnapshot"));
  const result = {
    restarts,
    rebuilds,
    heapScope: "main page JS after GC; not GPU driver/process memory",
  };
  await writeFile(resolve(output, "stability.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
