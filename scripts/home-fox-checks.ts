import assert from "node:assert/strict";
import type { Locator, Page } from "playwright-core";

/** The fox's eased gaze as [x, y] in -1..1, read from its data-look mirror. */
async function gaze(fox: Locator) {
  return ((await fox.getAttribute("data-look")) ?? "0 0").split(" ").map(Number) as [number, number];
}

/** Wait for rendered stillness, not a wall-clock delay on a busy CI host. */
async function restingGaze(fox: Locator) {
  return fox.evaluate(async node => {
    let previous = node.getAttribute("data-look");
    let quietFrames = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(requestAnimationFrame);
      const current = node.getAttribute("data-look");
      quietFrames = current === previous ? quietFrames + 1 : 0;
      if (quietFrames === 3) return current;
      previous = current;
    }
    throw new Error("Fox gaze did not settle within 120 rendered frames");
  });
}

const lookX = () => Number((document.querySelector("[data-fox]")!.getAttribute("data-look") ?? "0").split(" ")[0]);

export async function verifyFox(page: Page) {
  const fox = page.locator("[data-fox]");
  assert.ok(await fox.isVisible(), "the fox is rendered in the hero");
  await page.waitForFunction(() => document.querySelector("[data-fox]")!.hasAttribute("data-live"), null, { timeout: 15000 });
  assert.ok(await fox.locator(".fox-canvas").isVisible(), "the 3D fox plays in the hero");
  assert.equal(await fox.locator(".fox-poster").evaluate(node => getComputedStyle(node).opacity), "0", "the still mascot steps aside while the 3D fox plays");
  await page.mouse.move(1400, 100);
  await page.waitForFunction(`(${lookX})() > 0.02`);
  await page.mouse.move(20, 100);
  await page.waitForFunction(`(${lookX})() < -0.02`);
  const settled = await restingGaze(fox);
  await page.waitForTimeout(100);
  assert.equal(await fox.getAttribute("data-look"), settled, "gaze stops updating once settled");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector("[data-fox]")!.getAttribute("data-look") === "0 0");
  await page.mouse.move(1400, 800);
  await page.waitForTimeout(100);
  assert.equal(await fox.getAttribute("data-look"), "0 0", "reduced motion disables tracking");
  assert.ok(await fox.locator(".fox-poster").isVisible(), "reduced motion brings the still mascot back");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // MediaQueryList's change event is delivered on the next rendering turn.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(20, 100);
  await restingGaze(fox);
  const beforeTouch = (await gaze(fox))[0];
  assert.ok(beforeTouch < 0, "mouse tracking resumes after reduced motion is turned off");
  await fox.dispatchEvent("pointermove", { pointerType: "touch", clientX: 1400, clientY: 800, bubbles: true });
  await page.waitForTimeout(300);
  // Slow frames may still converge left; a rightward touch must not redirect it.
  assert.ok((await gaze(fox))[0] <= beforeTouch + .005, "touch scrolling never redirects the gaze");
  await page.locator("html").dispatchEvent("pointerleave");
  await restingGaze(fox);
  const [x, y] = await gaze(fox);
  assert.ok(Math.abs(x) < .003 && Math.abs(y) < .003, "pointer exit gently returns to center");
  await page.mouse.move(1400, 100);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.equal(await fox.getAttribute("data-look"), "0 0", "tab visibility changes settle the fox");
  await page.locator(".boundary").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.mouse.move(20, 200);
  await page.waitForTimeout(200);
  assert.equal(await fox.getAttribute("data-look"), "0 0", "offscreen art ignores pointer movement");
  await page.evaluate(() => window.scrollTo(0, 0));
}
