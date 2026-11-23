import { expect, test } from "@playwright/test";

test("loads Blender LODs and reports all rendering passes within the low scene budget", async ({
  page,
}, testInfo) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/probe/?benchmark=1&quality=low");
  await expect(page.locator("#viewport")).toHaveAttribute("data-graphics", "ready", {
    timeout: 30000,
  });
  const report = await page.evaluate(async () => {
    const node = document.getElementById("viewport");
    if (!node) throw new Error("Missing scene");
    return await new Promise<{
      maxCalls: number;
      maxTriangles: number;
      software: boolean;
      width: number;
      height: number;
    }>((done) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          node.addEventListener(
            "probe-report-result",
            (event) => done((event as CustomEvent).detail),
            { once: true },
          );
          node.dispatchEvent(new Event("probe-report"));
        }),
      );
    });
  });
  expect(report.maxCalls).toBeGreaterThan(0);
  expect(report.maxCalls).toBeLessThanOrEqual(80);
  expect(report.maxTriangles).toBeLessThanOrEqual(150000);
  expect(report.height).toBeLessThanOrEqual(720);
  expect(errors).toEqual([]);
  await testInfo.attach("scene-smoke-not-a-performance-benchmark", {
    body: JSON.stringify(report),
    contentType: "application/json",
  });
  await page.screenshot({ path: testInfo.outputPath("coastal-stress.png") });
});
