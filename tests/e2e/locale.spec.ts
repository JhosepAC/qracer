import { expect, test } from "@playwright/test";

test("switches language during a run without reloading or changing its category", async ({
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
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Drive the coast" })).toBeVisible();
  await page.getByRole("button", { name: "Sound and comfort" }).click();
  await page.getByLabel("Mute", { exact: true }).check();
  await page.getByLabel("Reduce motion", { exact: true }).check();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Hit the road" }).click();
  const category = await page.locator("#app").getAttribute("data-run-category");
  const language = page.getByLabel("Language", { exact: true });
  await language.focus();
  await language.press("ArrowUp");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  expect(await page.locator("#app").getAttribute("data-run-category")).toBe(category);
  await expect(page.locator("#integrity")).toHaveText("Integridad 3/3");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Carrera en pausa" })).toBeVisible();
  await page.getByLabel("Idioma", { exact: true }).selectOption("en");
  await expect(page.getByRole("heading", { name: "Race paused" })).toBeVisible();
  await expect(page.locator("#integrity")).toHaveText("Integrity 3/3");
  await page.screenshot({ path: info.outputPath("english-pause.png") });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.route("**/session", (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: '{"error":"quota"}' }),
  );
  await page.getByRole("button", { name: "Connect phone" }).click();
  await page.getByRole("button", { name: "Generate invitation" }).click();
  await expect(page.locator("#host-pair-status")).toHaveText(
    "Pairing quota exhausted. You can use the keyboard or the local edition.",
  );
});

test("localizes a linked handset and denied sensors without losing the session", async ({
  page,
  browser,
}, info) => {
  const phone = await browser.newPage({
    viewport: { width: 320, height: 568 },
    hasTouch: true,
    isMobile: true,
  });
  await phone.addInitScript(() => {
    Object.defineProperty(DeviceOrientationEvent, "requestPermission", {
      value: async () => "denied",
    });
  });
  try {
    await page.goto("/play/");
    await page.getByRole("button", { name: "Conectar móvil" }).click();
    await page.getByRole("button", { name: "Generar invitación" }).click();
    await expect(page.locator("#host-link")).toBeVisible();
    await phone.goto(await page.locator("#host-link").inputValue());
    await page.getByRole("button", { name: "Aprobar mando" }).click();
    await expect(phone.locator("#drive-shell")).toBeVisible();
    const resume = await phone.evaluate(() => sessionStorage.getItem("qracer.resume.v1"));
    await phone.getByLabel("Idioma", { exact: true }).selectOption("en");
    await expect(phone.locator("#pair-status")).toHaveText(
      "Controller paired. Choose ‘Play with phone’ on the PC.",
    );
    await phone.getByRole("button", { name: "Enable tilt" }).click();
    await expect(phone.locator("#tilt-status")).toHaveText(
      "Permission denied. Touch controls remain available.",
    );
    expect(await phone.evaluate(() => sessionStorage.getItem("qracer.resume.v1"))).toBe(resume);
    await phone.screenshot({ path: info.outputPath("english-phone.png"), fullPage: true });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await phone.getByLabel("Language", { exact: true }).selectOption("es");
    await expect(phone.locator("#tilt-status")).toHaveText(
      "Permiso denegado. El mando sigue en táctil.",
    );
  } finally {
    await phone.close();
  }
});
