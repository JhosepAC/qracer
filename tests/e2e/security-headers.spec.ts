import { expect, test } from "@playwright/test";

test("enforces CSP while loading real decoders and restricts permissions by document", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 480, height: 320 });
  await page.addInitScript(() => {
    localStorage.setItem("qracer.graphics.quality", "low");
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      violations.push(event.effectiveDirective),
    );
    Object.assign(window, { f12Violations: violations });
  });
  const response = await page.goto("/play/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "script-src 'self' 'wasm-unsafe-eval'",
  );
  await expect(page.locator("#start")).toBeEnabled({ timeout: 25000 });
  await page.locator("#start").click();
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => (window as unknown as { f12Violations: string[] }).f12Violations),
  ).toEqual([]);
  const permissions = await page.evaluate(() => {
    const policy = (
      document as Document & { featurePolicy: { allowsFeature(name: string): boolean } }
    ).featurePolicy;
    return {
      camera: policy.allowsFeature("camera"),
      microphone: policy.allowsFeature("microphone"),
      gyro: policy.allowsFeature("gyroscope"),
    };
  });
  expect(permissions).toEqual({ camera: false, microphone: false, gyro: false });
  let fetched = false;
  await page.route("https://blocked.invalid/**", (route) => {
    fetched = true;
    return route.fulfill({ body: "window.f12Executed=true" });
  });
  await page.evaluate(async () => {
    const inline = document.createElement("script");
    inline.textContent = "window.f12Executed=true";
    document.body.append(inline);
    const external = document.createElement("script");
    external.src = "https://blocked.invalid/injected.js";
    document.body.append(external);
    await fetch("https://blocked.invalid/input").catch(() => undefined);
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { f12Violations: string[] }).f12Violations.length),
    )
    .toBeGreaterThan(0);
  expect(fetched).toBe(false);
  expect(await page.evaluate(() => "f12Executed" in window)).toBe(false);
  const workerBlocked = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const source = URL.createObjectURL(
          new Blob(
            [
              `fetch("https://blocked.invalid/from-worker").then(()=>postMessage("leaked"),()=>postMessage("blocked"));`,
            ],
            { type: "text/javascript" },
          ),
        );
        const worker = new Worker("/decoder-worker.js");
        const finish = (blocked: boolean) => {
          worker.terminate();
          URL.revokeObjectURL(source);
          resolve(blocked);
        };
        worker.onmessage = (event) => finish(event.data === "blocked");
        worker.onerror = (event) => {
          event.preventDefault();
          finish(false);
        };
        worker.postMessage({ type: "load-decoder", source });
      }),
  );
  expect(workerBlocked).toBe(true);
  expect(fetched).toBe(false);
  await page.goto("/controller/");
  expect(
    await page.evaluate(() =>
      (
        document as Document & { featurePolicy: { allowsFeature(name: string): boolean } }
      ).featurePolicy.allowsFeature("gyroscope"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      (
        document as Document & { featurePolicy: { allowsFeature(name: string): boolean } }
      ).featurePolicy.allowsFeature("camera"),
    ),
  ).toBe(false);
});
