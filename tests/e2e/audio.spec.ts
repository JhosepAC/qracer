import { expect, test } from "@playwright/test";

test("requires a play gesture, supports silent play and suspends real audio on pause", async ({
  page,
}) => {
  await page.route("**/assets/race-view-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export async function createRaceView(container) { const canvas=document.createElement('canvas');container.append(canvas);return { canvas,draw(){},stats:()=>({}),dispose:()=>canvas.remove() }; }`,
    }),
  );
  await page.addInitScript(() => {
    const contexts: { context: AudioContext; analyser: AnalyserNode; tones: OscillatorNode[] }[] =
      [];
    Object.assign(window, { qracerAudioTest: contexts });
    window.AudioContext = new Proxy(window.AudioContext, {
      construct(Target, args) {
        const context = new Target(args[0]);
        const analyser = context.createAnalyser();
        const original = context.createDynamicsCompressor.bind(context);
        context.createDynamicsCompressor = () => {
          const limiter = original();
          limiter.connect(analyser);
          return limiter;
        };
        const tones: OscillatorNode[] = [];
        const oscillator = context.createOscillator.bind(context);
        context.createOscillator = () => {
          const node = oscillator();
          tones.push(node);
          return node;
        };
        contexts.push({ context, analyser, tones });
        return context;
      },
    });
  });
  const count = () =>
    page.evaluate(
      () => (window as unknown as { qracerAudioTest: unknown[] }).qracerAudioTest.length,
    );
  await page.goto("/play/");
  await expect.poll(count).toBe(0);
  await page.getByRole("button", { name: "Sonido y comodidad" }).click();
  await page.getByLabel("Silencio", { exact: true }).check();
  await page.getByRole("button", { name: "Cerrar ajustes" }).click();
  await expect(page.locator("#presentation-open")).toBeFocused();
  await page.getByRole("button", { name: "Salir a pista" }).click();
  await page.waitForTimeout(150);
  expect(await count()).toBe(0);
  await page.getByRole("button", { name: "Sonido y comodidad" }).click();
  await expect(
    page.getByRole("heading", { name: "Carrera en pausa", includeHidden: true }),
  ).toBeAttached();
  await page.getByLabel("Silencio", { exact: true }).uncheck();
  await page.getByRole("slider", { name: /Volumen general/ }).fill("70");
  await page.getByRole("button", { name: "Cerrar ajustes" }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect.poll(count).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const entry = (window as unknown as { qracerAudioTest: { analyser: AnalyserNode }[] })
          .qracerAudioTest[0];
        if (!entry) return 0;
        const samples = new Float32Array(entry.analyser.fftSize);
        entry.analyser.getFloatTimeDomainData(samples);
        return Math.max(...samples.map((value) => Math.abs(value)));
      }),
    )
    .toBeGreaterThan(0.00001);
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { qracerAudioTest: { context: AudioContext }[] }).qracerAudioTest[0]
            ?.context.state,
      ),
    )
    .toBe("suspended");
  const tones = () =>
    page.evaluate(
      () =>
        (window as unknown as { qracerAudioTest: { tones: unknown[] }[] }).qracerAudioTest[0]?.tones
          .length ?? 0,
    );
  const before = await tones();
  await page.getByRole("button", { name: "Sonido y comodidad" }).click();
  await expect.poll(tones).toBeGreaterThan(before);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { qracerAudioTest: { context: AudioContext }[] }).qracerAudioTest[0]
            ?.context.state,
      ),
    )
    .toBe("suspended");
  expect(await count()).toBe(1);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("qracer.presentation.v1") ?? "{}"),
  );
  expect(saved.master).toBe(0.7);
});
