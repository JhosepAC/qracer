import { expect, test } from "@playwright/test";

const origin = "http://qracer.test:4173";
test.use({
  baseURL: origin,
  launchOptions: { args: ["--host-resolver-rules=MAP qracer.test 127.0.0.1", "--no-proxy-server"] },
});

test("pairs by pasted link, consumes the QR, reconnects and approves replacement", async ({
  page,
  browser,
}, info) => {
  const handset = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const secondHandset = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  for (const context of [page.context(), handset, secondHandset])
    await context.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).RTCPeerConnection;
    });
  try {
    await page.goto("/play/");
    await page.getByRole("button", { name: "Conectar móvil" }).click();
    const panel = page.getByRole("dialog", { name: "Conecta tu móvil" });
    await panel.getByRole("button", { name: "Generar invitación" }).click();
    await expect(panel.getByRole("img", { name: "Código QR de invitación" })).toBeVisible();
    await expect(panel.locator("#host-qr svg")).toBeVisible();
    const url = await panel.getByLabel("Enlace de uso único").inputValue();

    const phone = await handset.newPage();
    await phone.goto(`${origin}/controller/`);
    await phone.getByLabel("Enlace de invitación").fill(url);
    await phone.getByRole("button", { name: "Solicitar acceso" }).click();
    await expect(phone.locator("#pair-status")).toContainText("Esperando aprobación");
    const code = await phone.locator("#pair-code").textContent();
    expect(code).toMatch(/^\d{6}$/);
    await expect(panel.locator("#host-pair-code")).toHaveText(code ?? "");
    await expect(panel.getByRole("img", { name: "Código QR de invitación" })).toBeHidden();
    await panel.screenshot({ path: info.outputPath("pairing-confirmation.png") });
    await panel.getByRole("button", { name: "Aprobar mando" }).click();
    await expect(phone.locator("#pair-status")).toContainText("Mando vinculado");
    await expect(phone.locator("#app")).toHaveAttribute("data-epoch", "1");
    await phone.reload();
    await expect(phone.locator("#app")).toHaveAttribute("data-epoch", "2");
    await expect(phone.locator("#pair-status")).toContainText("Mando vinculado");

    const second = await secondHandset.newPage();
    await second.goto(url);
    await expect.poll(() => second.evaluate(() => location.hash.length)).toBe(0);
    await expect(second.locator("#pair-status")).toContainText("ya fue usada");
    await panel.getByRole("button", { name: "Invitar otro móvil" }).click();
    await expect(panel.getByLabel("Enlace de uso único")).toBeVisible();
    const fresh = await panel.getByLabel("Enlace de uso único").inputValue();
    expect(fresh === url).toBe(false);
    await second.goto(fresh);
    await expect.poll(() => second.evaluate(() => location.hash.length)).toBe(0);
    await expect(second.locator("#pair-status")).toContainText("Esperando aprobación");
    await expect(phone.locator("#pair-status")).toContainText("Mando vinculado");
    await panel.getByRole("button", { name: "Aprobar sustitución" }).click();
    await expect(second.locator("#app")).toHaveAttribute("data-epoch", "3");
    await expect(phone.locator("#pair-status")).toContainText("revocó");
    await expect(phone.getByRole("button", { name: "Solicitar acceso" })).toBeVisible();
    await panel.getByRole("button", { name: "Revocar mando" }).click();
    await expect(second.locator("#pair-status")).toContainText("revocó");
    await panel.getByRole("button", { name: "Cerrar sala" }).click();
    await expect(panel.locator("#host-pair-status")).toContainText("Sala cerrada");
  } finally {
    await handset.close();
    await secondHandset.close();
  }
});

test("shows quota and version errors and keeps the keyboard route available", async ({ page }) => {
  await page.route("**/session", (route) =>
    route.fulfill({ status: 429, json: { code: "QUOTA_EXHAUSTED" } }),
  );
  await page.goto("/play/");
  const trigger = page.getByRole("button", { name: "Conectar móvil" });
  await trigger.click();
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "Generar invitación" }).click();
  await expect(panel.locator("#host-pair-status")).toContainText("Cuota de vinculación agotada");
  await page.unroute("**/session");
  await page.route("**/session", (route) => route.fulfill({ status: 201, json: { version: 4 } }));
  await panel.getByRole("button", { name: "Generar invitación" }).click();
  await expect(panel.locator("#host-pair-status")).toContainText("Versión incompatible");
  await panel.getByRole("button", { name: "Cerrar panel" }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Salir a pista" })).toBeVisible();
});
