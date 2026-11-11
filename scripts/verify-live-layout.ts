#!/usr/bin/env bun
/** Responsive hero acceptance; beta writes are always answered locally. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { chromium, type FrameLocator } from "playwright-core";
import { verifyParentKeyboard } from "./home-keyboard-checks";

const root = resolve(import.meta.dir, "../dist");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  let path = resolve(root, `.${url.pathname}`);
  if (!path.startsWith(`${root}/`) && path !== root) return new Response(null, { status: 403 });
  if (url.pathname === "/") path = resolve(root, "index.html");
  if (!extname(path)) path += ".html";
  const file = Bun.file(path);
  return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
} });
const base = process.env.HERO_URL ?? `http://127.0.0.1:${server.port}`;
const baseline = process.env.GEOMETRY_BASELINE === "1";
const artifacts = new URL("../.home-check/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function verifyWorkspaceLayout(hero: FrameLocator, width: number) {
  const layout = await hero.locator(".live-stage").evaluate(async root => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const box = (node: Element) => { const { left, right, top, bottom, height } = node.getBoundingClientRect(); return { left, right, top, bottom, height }; };
    const frame = root.querySelector(".live-window")!;
    return { stage: box(root), frame: box(frame), screen: box(frame.querySelector(".live-screen")!), viewportHeight: innerHeight, viewportWidth: innerWidth };
  });
  assert.ok(layout.stage.height <= layout.viewportHeight + 1, `iframe contains the full workspace at ${width}`);
  assert.ok(layout.frame.left >= -1 && layout.frame.right <= layout.viewportWidth + 1, `window fits horizontally at ${width}`);
  assert.ok(layout.frame.top >= -1 && layout.frame.bottom <= layout.stage.height + 1, `window fits vertically at ${width}`);
  // The terminal keeps one height in every phase, so connecting never moves the page.
  assert.equal(layout.screen.height, width <= 700 ? 296 : 408, `terminal height is fixed at ${width}`);
}

async function assertCount(hero: FrameLocator, count: number) {
  for (let i = 0; i < 100 && await hero.locator(".live-tile").count() !== count; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await hero.locator(".live-tile").count(), count, "closing a pane removes exactly one");
}

try {
  await mkdir(artifacts, { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
    if (process.env.HERO_LIVE !== "1") {
      await context.routeWebSocket(/wss?:\/\//, socket => socket.close());
    }
    // Serve the local build under the public browser origin, which the real
    // demo WebSocket requires. This never serves or modifies production assets.
    await context.route("https://phux.sh/**", async route => {
      const url = new URL(route.request().url());
      await route.fulfill({ response: await route.fetch({ url: `${base}${url.pathname}${url.search}` }) });
    });
    const page = await context.newPage();
    let submitted = "", platform = "";
    await page.route("**/api/beta", route => {
      ({ email: submitted, platform } = route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, status: "invited" } });
    });
    await page.goto("https://phux.sh/?hero=light");
    const hero = page.frameLocator("#home-light iframe");
    await hero.locator(".install-hook").waitFor();
    assert.equal(await hero.locator(".install-hook-lede, .install-hook-proof, .live-session-hint").count(), 0, "no marketing prose around the controls");
    assert.equal(await hero.locator(".live-window > .install-hook").count(), 1, "install controls belong to the terminal window");
    assert.equal(await hero.locator(".live-screen .install-hook").count(), 0, "terminal connection overlays cannot cover the install controls");
    assert.equal(await hero.locator(".live-stage dialog").count(), 0, "the terminal is used in place, never in a dialog");
    if (process.env.HERO_LIVE === "1") await hero.locator('.live-window[data-phase="live"] .live-tile').first().waitFor({ timeout: 45_000 });
    await verifyWorkspaceLayout(hero, width);
    await hero.locator(".install-hook").screenshot({ path: `${artifacts}install-${baseline ? "before" : "after"}-${width}.png` });
    // Full-page capture scrolls away from the workspace and legitimately disposes
    // this lazy iframe; capture the active viewport rather than changing its lifecycle.
    await page.screenshot({ path: `${artifacts}hero-${baseline ? "before" : "after"}-${width}.png` });
    assert.ok(await hero.getByRole("region", { name: "Install phux", exact: true }).isVisible(), "install controls keep an accessible name without a heading");
    await hero.getByRole("button", { name: "Rune", exact: true }).click();
    assert.equal(await hero.getByRole("link", { name: "Download", exact: true }).getAttribute("href"), "/download/rune", "Rune is a download");
    await hero.getByRole("button", { name: "Copy the Rune install command", exact: true }).click();
    await hero.getByRole("status").filter({ hasText: "Copied." }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "curl -fsSL https://phux.sh/install | sh -s -- --rune");
    assert.equal(await hero.locator(".install-hook").getByRole("status").innerText(), "Copied.", "copy feedback stays concise");
    await hero.getByRole("button", { name: "CLI", exact: true }).click();
    assert.equal(await hero.locator(".install-hook-line code").innerText(), "curl -fsSL https://phux.sh/install | sh");
    await hero.getByRole("button", { name: "iPhone", exact: true }).click();
    assert.equal(await hero.getByRole("link", { name: "Open TestFlight" }).getAttribute("href"), "/download/ios");
    await hero.locator("[data-email-invite] > summary").click();
    const input = hero.getByRole("textbox", { name: "Email address for the TestFlight invite" });
    const geometry = await input.evaluate(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      const form = node.closest("form")!.getBoundingClientRect();
      return { height: box.height, width: box.width, font: style.fontSize, appearance: style.appearance, formHeight: form.height, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    await page.screenshot({ path: `${artifacts}iphone-${baseline ? "before" : "after"}-${width}.png` });
    console.log(JSON.stringify({ viewport: width, ...geometry }));
    if (!baseline) {
      assert.equal(geometry.overflow, false, `no frame overflow at ${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no page overflow at ${width}`);
      assert.ok(geometry.height >= 44 && geometry.height <= 52, `compact accessible email height at ${width}`);
      assert.ok(geometry.formHeight <= 64, `signup uses one compact shared surface at ${width}`);
      assert.equal(geometry.appearance, "none", "email controls do not use the platform's native inset style");
      assert.ok(parseFloat(geometry.font) >= 16, "email entry does not trigger iPhone focus zoom");
      await verifyParentKeyboard(page, hero);
      await input.fill("layout@example.com");
      await hero.getByRole("button", { name: "Request access", exact: true }).click();
      await hero.getByRole("status").filter({ hasText: "Invite sent" }).waitFor();
      assert.equal(submitted, "layout@example.com", "signup still posts the entered address");
      assert.equal(platform, "ios", "a computer is offered the iPhone beta first");
      assert.ok(await input.evaluate(node => Boolean(node.closest(".live-window"))), "email entry is inside the terminal window");
      await verifyWorkspaceLayout(hero, width);
      await hero.getByRole("button", { name: "Android instead", exact: true }).click();
      assert.equal(await hero.getByRole("button", { name: "Android", exact: true }).getAttribute("aria-pressed"), "true", "the mobile target follows the chosen phone");
      await hero.getByRole("textbox", { name: "Email address for the Google Play test" }).fill("android@example.com");
      await hero.getByRole("button", { name: "Request access", exact: true }).click();
      await hero.getByRole("status").filter({ hasText: "Google Play" }).waitFor();
      assert.equal(platform, "android", "the Android request says so");
      await verifyWorkspaceLayout(hero, width);
    }
    if (process.env.HERO_LIVE === "1") {
      // A split happens in place: same window, one more pane, no new surface.
      const before = await hero.locator(".live-tile").count();
      await hero.getByRole("button", { name: "Split down", exact: true }).click();
      await hero.locator(".live-tile").nth(before).waitFor();
      await hero.getByRole("button", { name: "Close pane", exact: true }).click();
      await assertCount(hero, before);
      await verifyWorkspaceLayout(hero, width);
      await page.screenshot({ path: `${artifacts}split-${width}.png` });
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.stop(true);
}
