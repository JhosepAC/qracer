import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("downloads a local PNG, regenerates its locale and handles optional sharing failures", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        if (data.files?.[0]?.type !== "image/png") throw new Error("Missing PNG");
        const state = document.body.dataset.shareTest;
        if (state === "cancel") throw new DOMException("cancel", "AbortError");
        if (state === "fail") throw new Error("unavailable");
      },
    });
    localStorage.setItem("qracer.graphics.quality", "low");
    localStorage.setItem("qracer.presentation.v1", JSON.stringify({ muted: true }));
  });
  await page.goto("/play/");
  await page.locator("#run-mode").selectOption("practice");
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Terminar práctica" }).click();
  await expect(page.locator("#download-card")).toBeEnabled();
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-card").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("qracer-carrera.png");
  const path = await download.path();
  if (!path) throw new Error("Missing image");
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1280, 720]);
  await download.saveAs(info.outputPath("result-card.png"));
  await page.locator("#share-card").click();
  await expect(page.locator("#card-status")).toHaveText("Tarjeta compartida.");
  await page.evaluate(() => {
    document.body.dataset.shareTest = "cancel";
  });
  await page.locator("#share-card").click();
  await expect(page.locator("#card-status")).toContainText("cancelado");
  await page.evaluate(() => {
    document.body.dataset.shareTest = "fail";
  });
  await page.locator("#share-card").click();
  await expect(page.locator("#card-status")).toContainText("Descarga");
  await page.getByRole("combobox", { name: "Idioma" }).selectOption("en");
  await expect(page.locator("#card-status")).toHaveText("Card ready. Generated on this device.");
  await page.locator("#return-menu").click();
  await expect(page.locator("#download-card")).toBeHidden();
});

test("keeps download available without Web Share", async ({ page }) => {
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container){const canvas=document.createElement('canvas');container.append(canvas);return {canvas,draw(){},stats:()=>({}),dispose(){canvas.remove()}}}`,
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined });
    Object.defineProperty(navigator, "share", { value: undefined });
  });
  await page.goto("/play/");
  await page.locator("#run-mode").selectOption("practice");
  await page.locator("#start").click();
  await page.locator("#finish-practice").click();
  await expect(page.locator("#download-card")).toBeEnabled();
  await expect(page.locator("#share-card")).toBeHidden();
});
