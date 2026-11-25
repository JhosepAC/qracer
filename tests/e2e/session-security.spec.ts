import { expect, test } from "@playwright/test";

test("discards expired and legacy resume credentials before opening a socket", async ({ page }) => {
  await page.goto("/controller/");
  let sockets = 0;
  page.on("websocket", () => sockets++);
  for (const until of [Date.now() - 1, undefined, Date.now() + 3 * 60 * 60_000]) {
    await page.evaluate((expires) => {
      sessionStorage.setItem(
        "qracer.resume.v1",
        JSON.stringify({ room: "a".repeat(32), token: "b".repeat(64), until: expires }),
      );
    }, until);
    await page.reload();
    await expect(page.locator("#join-form")).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("qracer.resume.v1"))).toBeNull();
  }
  expect(sockets).toBe(0);
});
