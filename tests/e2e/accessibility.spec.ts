import { expect, test } from "@playwright/test";

test("keeps menus operable by keyboard with large text, clear focus and readable controls", async ({
  page,
}, info) => {
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container){const canvas=document.createElement("canvas");container.append(canvas);return {canvas,draw(){},stats:()=>({}),dispose(){canvas.remove()}};}`,
    }),
  );
  await page.goto("/play/");
  await page.getByLabel("Idioma", { exact: true }).selectOption("en");
  // 640 CSS pixels is a 1280px desktop at 200% browser zoom. Increasing the root
  // font separately also stresses wrapped controls rather than merely scaling pixels.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const keyboard = page.getByText("Keyboard controls", { exact: true });
  await keyboard.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".race-keyboard")).toHaveAttribute("open", "");
  const settings = page.getByRole("button", { name: "Sound and comfort" });
  await settings.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Sound and comfort" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    // Chromium may briefly focus browser chrome (body as activeElement) at the
    // end of the native dialog cycle; background page controls must stay inert.
    expect(
      await dialog.evaluate(
        (node) => node.contains(document.activeElement) || document.activeElement === document.body,
      ),
    ).toBe(true);
  }
  if (await page.evaluate(() => document.activeElement === document.body))
    await page.keyboard.press("Tab");
  const focused = await page.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineStyle,
  );
  expect(focused).not.toBe("none");
  const targets = await dialog
    .locator("button, input[type=range], label:has(input[type=checkbox]), summary")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getClientRects().length)
        .map((node) => {
          const r = node.getBoundingClientRect();
          return { name: node.textContent?.trim(), width: r.width, height: r.height };
        }),
    );
  expect(targets.filter((r) => r.width < 48 || r.height < 48)).toEqual([]);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("comfort-large-text.png") });
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
  const contrast = await page.locator("#host-pair, #start").evaluateAll((nodes) => {
    const light = (css: string) => {
      const rgb =
        css
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      return rgb.reduce((sum, value, i) => {
        const c = value / 255;
        return (
          sum +
          (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
            ([0.2126, 0.7152, 0.0722][i] ?? 0)
        );
      }, 0);
    };
    return nodes.map((node) => {
      const s = getComputedStyle(node),
        a = light(s.color),
        b = light(s.backgroundColor);
      return {
        id: node.id,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        foreground: s.color,
        background: s.backgroundColor,
      };
    });
  });
  expect(contrast.every((pair) => pair.ratio >= 4.5)).toBe(true);
  await info.attach("measured-control-contrast", {
    body: JSON.stringify(contrast, null, 2),
    contentType: "application/json",
  });
  const pair = page.getByRole("button", { name: "Connect phone" });
  await pair.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Connect your phone" })).toBeVisible();
  const generate = page.getByRole("button", { name: "Generate invitation" });
  await generate.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#host-link")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pair).toBeFocused();
});
