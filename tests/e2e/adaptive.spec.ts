import { expect, test } from "@playwright/test";

test("adjusts the real drawing buffer under sustained slow frames and preserves the user's override", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 480, height: 320 });
  await page.addInitScript(() => {
    localStorage.setItem("qracer.graphics.quality", "low");
    localStorage.setItem("qracer.presentation.v1", JSON.stringify({ muted: true }));
    const request = window.requestAnimationFrame.bind(window);
    let time = 0;
    performance.now = () => time;
    window.requestAnimationFrame = (callback) =>
      request(() => {
        time += 80;
        callback(time);
      });
  });
  await page.goto("/play/");
  await page.locator("#start").click();
  const category = await page.locator("#app").getAttribute("data-run-category");
  await expect
    .poll(
      async () =>
        JSON.parse((await page.locator("#preview").getAttribute("data-render-stats")) ?? "{}")
          .resolutionScale,
      { timeout: 20000 },
    )
    .toBeLessThan(1);
  expect(
    await page.locator("#preview canvas").evaluate((node) => (node as HTMLCanvasElement).width),
  ).toBeLessThan(480);
  await expect(page.locator("#app")).toHaveAttribute("data-run-category", category ?? "");
  await page.keyboard.press("Escape");
  await page.locator("#return-menu").click();
  await page.locator("#graphics-adaptive").uncheck();
  await page.reload();
  await expect(page.locator("#graphics-adaptive")).not.toBeChecked();
  await page.locator("#start").click();
  await expect
    .poll(
      async () =>
        JSON.parse((await page.locator("#preview").getAttribute("data-render-stats")) ?? "{}")
          .adaptive,
    )
    .toBe(false);
  expect(
    await page.locator("#preview canvas").evaluate((node) => (node as HTMLCanvasElement).width),
  ).toBe(480);
});
