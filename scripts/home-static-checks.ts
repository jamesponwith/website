/** Reduced-motion and script-free homepage acceptance. */
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { HOME } from "../src/lib/site";

export async function verifyStaticHome(browser: Browser, base: string) {
  const stillContext = await browser.newContext({ reducedMotion: "reduce" });
  const stillPage = await stillContext.newPage();
  await stillPage.goto(`${base}/?hero=classic`);
  await stillPage.mouse.move(1200, 100);
  assert.equal(await stillPage.locator("[data-fox-look]").first().getAttribute("transform"), "translate(0 0)", "initial reduced motion keeps the fox centered");
  await stillPage.locator("#connection-details > summary").click();
  await stillPage.locator(".tour").scrollIntoViewIfNeeded();
  await stillPage.locator("astro-island:not([ssr]) .tour").waitFor();
  assert.equal(await stillPage.locator(".tour-play").count(), 0, "reduced motion does not autoplay");
  assert.equal(await stillPage.locator(".tour").getAttribute("data-playing"), "false");
  assert.ok(await stillPage.locator(".tour-summary").textContent(), "the illustration has a readable explanation");
  assert.match(await stillPage.locator(".tour-terminal").innerText(), /Finished/, "reduced motion shows the settled chapter");
  await stillContext.close();
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(base);
  assert.equal(await staticPage.locator(".download-primary [data-device-label]").innerText(), "Choose your platform", "without device detection, never guess Mac");
  assert.equal(await staticPage.locator(".download-primary").getAttribute("href"), "https://docs.phux.sh/installation", "the no-JS fallback is a real install guide");
  assert.ok(await staticPage.locator("[data-fox]").isVisible(), "the fox remains visible without JavaScript");
  assert.equal((await staticPage.getByRole("heading", { level: 1 }).innerText()).replace(/\s+/g, " ").trim(), HOME.headline);
  assert.equal((await staticPage.locator(".hero-description").innerText()).trim(), "Your agents. Your machines. One workspace.");
  assert.equal(await staticPage.locator(".workflow-grid article").count(), 3, "the work loop does not require hydration");
  assert.ok(await staticPage.getByRole("link", { name: "Set up Crew", exact: true }).isVisible(), "Crew setup works without JavaScript");
  assert.match(await staticPage.locator(".product-fit").innerText(), /With Crew/);
  await staticPage.locator(".install-options > summary").click();
  assert.ok(await staticPage.locator("#install code").isVisible());
  assert.equal(await staticPage.getByRole("slider").count(), 0, "no-JS does not offer an inert slider");
  assert.ok(await staticPage.locator(".client-tui").isVisible() && await staticPage.locator(".client-gui").isVisible(), "no-JS shows both static client previews");
  assert.equal(await staticPage.locator("iframe").count(), 0, "no-JS never downloads the live app");
  await staticPage.locator(".control-proof > summary").click();
  assert.ok(await staticPage.locator(".control-proof pre").isVisible(), "technical tools remain available without JavaScript");
  await staticPage.locator(".control-proof > summary").click();
  await staticPage.locator("#connection-details > summary").click();
  assert.equal(await staticPage.getByRole("link", { name: "Open demo", exact: true }).getAttribute("href"), "/embed");
  assert.match(await staticPage.locator(".tour-terminal").innerText(), /Finished/, "no-JS tour shows a settled scene");
  assert.equal(await staticPage.locator(".tour-lines > span").first().evaluate((node) => getComputedStyle(node).opacity), "1", "static output stays fully readable");
  await staticContext.close();
}
