import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test("serves a bilingual, tracking-free privacy notice with minimal permissions at desktop and phone sizes", async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).origin));
  const response = await page.goto("/privacy/");
  expect(response?.headers()["permissions-policy"]).toContain("gyroscope=()");
  expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-inline'");
  await expect(page.locator("article[lang=es]")).toContainText("sincronización");
  await expect(page.locator("article[lang=en]")).toContainText("no cloud sync");
  expect(await page.locator("script").count()).toBe(0);
  expect(await page.context().cookies()).toHaveLength(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`privacy-${width}.png`) });
  }
  expect(new Set(requests).size).toBe(1);
});

test("keeps the notice readable from a prepared offline game", async ({ page, context }) => {
  await page.goto("/play/");
  await expect(page.locator("#offline-status")).toContainText("disponible sin conexión", {
    timeout: 25000,
  });
  await context.setOffline(true);
  await page.goto("/privacy/");
  await expect(page.locator("#es-title")).toBeVisible();
  await page.getByRole("link", { name: "English", exact: true }).click();
  await expect(page.locator("#en-title")).toBeInViewport();
});
