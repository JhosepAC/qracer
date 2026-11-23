import { expect, test } from "@playwright/test";

test("desktop opens the controller through keyboard navigation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/play/");
  await expect(page.getByRole("heading", { name: /Siente cada/ })).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-protocol-version", "1");
  const supportsPreview = (await page.locator("#preview canvas").count()) > 0;
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
  const link = page.getByRole("link", { name: "Conocer el mando" });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/controller\/$/);
  await expect(page.getByRole("heading", { name: /El control/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: /Siente cada/ })).toBeVisible();
  if (supportsPreview) {
    // Also exercise BFCache events on engines that disable caching under automation.
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(page.locator("#preview canvas")).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

test("desktop remains usable when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript("HTMLCanvasElement.prototype.getContext = () => null");
  await page.goto("/play/");
  await expect(page.locator("#graphics-status")).toContainText("Activa WebGL 2");
  await expect(page.getByRole("link", { name: "Conocer el mando" })).toBeVisible();
});

test.describe("mobile controller", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("loads independently without renderer requests or horizontal overflow", async ({
    page,
  }, testInfo) => {
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await page.goto("/controller/");
    await expect(page.getByRole("heading", { name: /El control/ })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("próximamente");
    await expect(page.getByRole("button", { name: "Freno" })).toBeDisabled();
    expect(scripts.some((url) => /\/play-|three/i.test(url))).toBe(false);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("controller.png"), fullPage: true });
  });
});
