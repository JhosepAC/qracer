import { expect, test } from "@playwright/test";

test("probe authenticates two browsers, clears invitation and releases cancelled input", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/probe/");
  await page.getByRole("button", { name: "Crear enlace" }).click();
  const invite = page.getByRole("link", { name: "Abrir mando de prueba" });
  await expect(invite).toBeVisible();
  const href = await invite.getAttribute("href");
  expect(href).toContain("#relay=");
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(href ?? "");
  await expect(mobile.getByRole("status")).toHaveText("Conectado · WSS");
  expect(new URL(mobile.url()).hash).toBe("");
  const gas = mobile.getByRole("button", { name: "ACELERAR" });
  const right = mobile.getByRole("button", { name: "Girar a la derecha" });
  // Real pointer capture requires a trusted down; cancellation tests dispatch the corresponding browser event.
  const point = await gas.boundingBox();
  if (!point) throw new Error("Missing gas control");
  await mobile.mouse.move(point.x + 30, point.y + 30);
  await mobile.mouse.down();
  await expect(page.locator("#meter")).toContainText("GAS 1.0");
  await gas.dispatchEvent("pointercancel", { pointerId: 1 });
  await mobile.mouse.up();
  await expect(page.locator("#meter")).toContainText("GAS 0.0");
  await right.focus();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await mobile.screenshot({ path: testInfo.outputPath("probe-controller.png"), fullPage: true });
  await expect(page.locator("#metrics")).not.toContainText("RTT —", { timeout: 4000 });
  await mobileContext.close();
  await expect(page.locator("#meter")).toHaveText("PAUSA SEGURA");
  // Host screenshot excludes the consumed invitation/QR from its evidence.
  await page.locator("#invite").evaluate((node) => {
    node.removeAttribute("href");
  });
  await page.locator("#qr").evaluate((node) => {
    node.replaceChildren();
  });
  await page.screenshot({ path: testInfo.outputPath("probe-host.png"), fullPage: true });
});
