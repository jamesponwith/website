import assert from "node:assert/strict";
import type { Locator, Page } from "playwright-core";

/** Wait for rendered stillness, not a wall-clock delay on a busy CI host. */
async function restingEye(eye: Locator) {
  return eye.evaluate(async node => {
    let previous = node.getAttribute("transform");
    let quietFrames = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(requestAnimationFrame);
      const current = node.getAttribute("transform");
      quietFrames = current === previous ? quietFrames + 1 : 0;
      if (quietFrames === 3) return current;
      previous = current;
    }
    throw new Error("Fox gaze did not settle within 120 rendered frames");
  });
}

export async function verifyFox(page: Page) {
  const fox = page.locator("[data-fox]");
  const eye = fox.locator("[data-fox-look]").first();
  const position = () => eye.getAttribute("transform");
  assert.ok(await fox.isVisible(), "the emblem fox is rendered in the hero");
  await page.mouse.move(1400, 100);
  await page.waitForFunction(() => {
    const value = document.querySelector("[data-fox-look]")!.getAttribute("transform") ?? "";
    return Number(value.match(/translate\(([-.\d]+)/)?.[1]) > 0.1;
  });
  await page.mouse.move(20, 100);
  await page.waitForFunction(() => {
    const value = document.querySelector("[data-fox-look]")!.getAttribute("transform") ?? "";
    return Number(value.match(/translate\(([-.\d]+)/)?.[1]) < -0.1;
  });
  const settled = await restingEye(eye);
  await page.waitForTimeout(100);
  assert.equal(await position(), settled, "gaze stops repainting once settled");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector("[data-fox-look]")!.getAttribute("transform") === "translate(0 0)");
  await page.mouse.move(1400, 800);
  await page.waitForTimeout(100);
  assert.equal(await position(), "translate(0 0)", "reduced motion disables tracking");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // MediaQueryList's change event is delivered on the next rendering turn.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(20, 100);
  const beforeTouch = await restingEye(eye);
  assert.notEqual(beforeTouch, "translate(0 0)", "mouse tracking resumes after reduced motion is turned off");
  const beforeTouchX = await eye.evaluate((node: SVGGElement) => node.transform.baseVal.consolidate()!.matrix.e);
  await fox.dispatchEvent("pointermove", { pointerType: "touch", clientX: 1400, clientY: 800, bubbles: true });
  await page.waitForTimeout(300);
  const afterTouchX = await eye.evaluate((node: SVGGElement) => node.transform.baseVal.consolidate()!.matrix.e);
  // Slow frames may still converge left; a rightward touch must not redirect it.
  assert.ok(afterTouchX <= beforeTouchX + .02, "touch scrolling never redirects the gaze");
  await page.locator("html").dispatchEvent("pointerleave");
  await restingEye(eye);
  const resting = await eye.evaluate((node: SVGGElement) => {
    const matrix = node.transform.baseVal.consolidate()!.matrix;
    return { e: matrix.e, f: matrix.f };
  });
  assert.ok(Math.abs(resting.e) < .01 && Math.abs(resting.f) < .01, "pointer exit gently returns to center");
  await page.mouse.move(1400, 100);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.equal(await position(), "translate(0 0)", "tab visibility changes settle the fox");
  await page.locator(".workflow-proof").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.mouse.move(20, 200);
  await page.waitForTimeout(200);
  assert.equal(await position(), "translate(0 0)", "offscreen art ignores pointer movement");
  await page.evaluate(() => window.scrollTo(0, 0));
}
