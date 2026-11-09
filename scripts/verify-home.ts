#!/usr/bin/env bun
/** Homepage acceptance against built assets; never uses a production server. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { verifyStaticHome } from "./home-static-checks";
import { verifyFox } from "./home-fox-checks";
import { verifyHomeContent } from "./home-content-checks";
import { verifyDeviceInstalls, verifyLinuxRune, verifyRuneDock } from "./home-platform-checks";
import { platformVisitors } from "./home-platform-fixtures";
import { homeServer } from "./home-server";
import { verifyEmailFallback } from "./home-email-fallback-checks";
import { verifyClientComparison, verifyHomeAuthReturn, verifyHostedShell, verifyTouchComparison, verifyWorkspaceInstallCopy, verifyWorkspaceResize } from "./home-interaction-checks";

const root = resolve(import.meta.dir, "../dist");
const artifacts = resolve(import.meta.dir, "../.home-check");
const server = homeServer(root);
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  await mkdir(artifacts, { recursive: true });
  const context = await browser.newContext({ userAgent: platformVisitors.mac.userAgent, viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], hasTouch: true });
  await context.addInitScript(() => Object.defineProperty(navigator, "maxTouchPoints", { get: () => 0 }));
  // Offline acceptance: never allocate production demo sessions or use real identity.
  await context.routeWebSocket(/wss?:\/\//, socket => socket.close());
  await context.route("**/auth/session", route => route.fulfill({ json: { authenticated: false } }));
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  // The TestFlight form is the one homepage network write; answer it locally.
  const beta: { payload: Record<string, string> | null } = { payload: null };
  await page.route("**/api/beta", async (route) => {
    beta.payload = route.request().postDataJSON() as Record<string, string>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, status: "invited" }),
    });
  });
  await page.goto(`${base}/`);
  await verifyHomeContent(page);
  assert.equal(await page.locator("#home-light iframe").count(), 0, "no live app exists before scrolling");
  assert.ok(await page.locator(".client-comparison").isVisible(), "real product screenshots lead the page");
  assert.equal(await page.locator(".download-primary").getAttribute("href"), "/download/rune", "the primary action downloads the Rune release");
  await page.waitForTimeout(350);
  assert.ok(!requests.some(url => /(?:HeroDemo|PhuxTerminal|VgpuPrototype)[^/]*\.js|\.wasm|\/auth\/session|\/healthz|phux-architecture\.mp4/.test(url)), "first fold does not download React demos, GPU, WASM, film or allocate sessions");
  await verifyFox(page);
  await verifyClientComparison(page, artifacts);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/home-desktop.png` });
  await page.screenshot({ path: `${artifacts}/home-full.png`, fullPage: true });
  assert.equal(await page.locator("#how-it-works").count(), 0, "no homepage explainer");
  assert.equal(await page.locator(".hero-headline, .live-invitation, .features").count(), 0, "the landing carries no slogan block");
  await page.locator(".install-options > summary").click();
  await page.waitForFunction(() => parseFloat(document.querySelector<HTMLElement>(".install-tabs")!.style.getPropertyValue("--pill-width")) > 0);
  const installBox = await page.locator("#install").boundingBox();
  const comparisonBox = await page.locator(".client-comparison").boundingBox();
  assert.ok(installBox && comparisonBox && installBox.y < comparisonBox.y, "install controls lead into the real product");
  assert.equal(await page.locator(".tour").isVisible(), false, "the optional walkthrough stays closed initially");
  assert.equal(await page.locator("#install .install-request").isHidden(), true, "the hero opens on a command, not the request form");
  assert.equal(await page.locator(".beta, #testflight").count(), 0, "the landing carries no separate TestFlight band");
  assert.equal(await page.locator(".tour").count(), 1, "one product tour");
  assert.equal(await page.locator("body > header").count(), 1, "the landing carries one top bar");
  assert.deepEqual(
    await page.locator("body > header nav[aria-label='Primary navigation']").getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("aria-label") ?? (link as HTMLElement).innerText)),
    ["phux", "Docs", "GitHub — phux source code"],
    "the top bar carries a recognizable GitHub source badge",
  );
  assert.equal(await page.locator(".tour-distant-host").count(), 3, "restrained background hosts");
  await page.locator("#connection-details > summary").click();
  const entry = page.getByRole("link", { name: "Open demo", exact: true });
  await page.locator(".tour").scrollIntoViewIfNeeded();
  await page.locator("astro-island:not([ssr]) .tour-entry").waitFor();
  assert.equal(await page.locator(".tour").getAttribute("data-pace"), "quick", "opens with the quick lap");
  await page.getByRole("button", { name: "Pause tour" }).click();
  const pausedProgress = await page.locator('.tour-chapters button[aria-pressed="true"]').getAttribute("style");
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tour-chapters button[aria-pressed="true"]').getAttribute("style"), pausedProgress, "pause freezes the quick lap");
  await page.getByRole("button", { name: "Play tour" }).click();
  await page.locator('.tour[data-pace="walkthrough"]').waitFor({ timeout: 12_000 });
  assert.equal(await page.locator('.tour-chapters button[aria-pressed="true"]').innerText(), "01 Attach", "quick lap restarts as an explanatory walkthrough");
  // The playback checks used the mouse. Exercise actual keyboard navigation
  // before asserting :focus-visible, rather than relying on browser modality.
  await entry.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".tour-open")!).opacity === "1");
  assert.equal(await page.locator(".tour-open").evaluate((node) => getComputedStyle(node).opacity), "1", "keyboard focus reveals the demo");
  assert.equal(await page.locator(".tour-open").evaluate((node) => getComputedStyle(node).backdropFilter), "none", "the invitation never blurs or covers the illustration");
  assert.equal((await page.locator(".tour-open").innerText()).trim(), "Open demo");
  assert.equal(await page.locator("dialog[open]").count(), 0, "discovery does not launch a session");
  await entry.hover();
  assert.equal(await page.locator("dialog[open]").count(), 0, "hover only prepares the client");
  const chapters = page.getByRole("group", { name: "Tour chapters" }).getByRole("button");
  assert.equal(await chapters.count(), 4, "four tour chapters");
  await chapters.nth(2).click();
  assert.equal(await chapters.nth(2).getAttribute("aria-pressed"), "true", "chapter selection");
  assert.equal(await page.locator(".tour").getAttribute("data-pace"), "walkthrough", "manual chapter selection uses readable pacing");
  await page.getByRole("button", { name: "Pause tour" }).click();
  assert.ok(await page.getByRole("button", { name: "Play tour" }).isVisible(), "tour pauses");
  await page.getByRole("button", { name: "Copy install command" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "curl -fsSL https://phux.sh/install | sh");
  assert.equal(await page.getByRole("status").innerText(), "Install command copied.");
  // The hero switcher swaps the command on hover, focus, click, and arrows,
  // turns Rune into a download, and the third target into the beta request.
  const command = page.locator("#install-command");
  const line = page.locator("#install .install-line");
  const request = page.locator("#install .install-request");
  const target = (name: string) => page.locator(`#install [data-install-target="${name}"]`);
  assert.deepEqual(await page.locator("#install .install-tabs button").allInnerTexts(), ["CLI", "Rune", "Mobile"], "three install targets");
  const download = page.locator("#install-download");
  await target("rune").hover();
  assert.ok(await download.isVisible(), "hover swaps to the Rune download");
  assert.equal(await command.isHidden(), true, "Rune leads with the download, not a command");
  await verifyRuneDock(page);
  await target("mobile").click();
  assert.equal(await target("mobile").getAttribute("aria-pressed"), "true", "the clicked target is pressed");
  assert.ok(await request.isVisible(), "Mobile asks for an address instead of printing a command");
  assert.equal(await line.isHidden(), true, "the command line steps aside for the request form");
  assert.match(await page.locator("#install-note").innerText(), /TestFlight/, "the note describes the mobile target");
  await target("mobile").focus();
  await page.keyboard.press("ArrowLeft");
  assert.ok(await download.isVisible(), "arrow keys move the target back to Rune");
  assert.equal(await request.isHidden(), true, "a command target hides the request form");
  assert.equal(await line.isVisible(), true, "a command target restores the command line");
  await page.getByRole("button", { name: "Copy install command" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "curl -fsSL https://phux.sh/install | sh -s -- --rune", "Rune keeps its installer on the copy button");
  // Regression: a content-sized dock widened with the command and slid the
  // targets out from under the pointer. The dock and its targets are pinned.
  const box = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
    });
  const dock = await box("#install");
  const cliTarget = await box('#install [data-install-target="cli"]');
  for (const name of ["rune", "mobile", "cli"]) {
    await target(name).hover();
    assert.deepEqual(await box("#install"), dock, `the dock keeps its box while ${name} is previewed`);
    assert.deepEqual(await box('#install [data-install-target="cli"]'), cliTarget, `targets stay pinned while ${name} is previewed`);
  }
  // The Mobile target carries the same TestFlight request /more posts.
  await target("mobile").click();
  assert.ok(await request.getByRole("link", { name: "Open TestFlight" }).isVisible(), "native TestFlight is the first iOS choice");
  await request.locator("[data-email-invite] > summary").click();
  await request.locator("input[name=email]").fill("iphone@example.com");
  await request.locator("button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#beta-note")?.textContent?.includes("Invite sent") ?? false);
  assert.match(await page.locator("#beta-note").innerText(), /Invite sent/, "the hero reports the invite");
  assert.equal(beta.payload?.email, "iphone@example.com", "the hero request posts the address");
  assert.equal(beta.payload?.website, "", "the honeypot stays empty");
  assert.equal(beta.payload?.platform, "ios", "a computer is offered the iPhone beta first");
  await request.getByRole("button", { name: "Android instead" }).click();
  assert.equal(await request.locator("input[name=email]").getAttribute("aria-label"), "Email address for the Google Play test", "the switch re-labels the address");
  await request.locator("input[name=email]").fill("android@example.com");
  await request.locator("button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#beta-note")?.textContent?.includes("Google Play") ?? false);
  assert.equal(beta.payload?.platform, "android", "the Android request says so");
  assert.ok(await request.getByRole("button", { name: "iPhone instead" }).isVisible(), "the switch offers the way back");
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 600 ? 740 : 900 });
    await page.locator(".install-options").evaluate((node: HTMLDetailsElement) => { node.open = false; });
    await page.evaluate(() => window.scrollTo(0, 0));
    const preview = (await page.locator(".client-comparison").boundingBox())!;
    assert.ok(preview.y < (width < 600 ? 740 : 650), `the fox and real product begin within the first screen at ${width}px`);
    const downloadBox = (await page.locator(".download-primary").boundingBox())!;
    assert.ok(downloadBox.y + downloadBox.height < preview.y, "the primary download is visible before the reveal");
    assert.ok(downloadBox.y + downloadBox.height < (width < 600 ? 500 : 600), "install is reachable without scrolling");
    await page.locator(".install-options > summary").click();
    for (const name of ["rune", "cli"]) {
      await target(name).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow with ${name} at ${width}px`);
    }
    assert.ok(await page.locator("#install code").evaluate((code) => code.scrollWidth <= code.clientWidth), `full install command readable at ${width}px`);
    assert.equal(await page.locator("#beta-note").innerText(), "", "changing install targets clears unrelated signup/copy feedback");
    await page.locator("#install-command").evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    await page.locator(".install-options > summary").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${artifacts}/home-${width}.png` });
  }
  await page.getByRole("link", { name: "Open demo", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  assert.equal(await page.locator(".tour").getAttribute("data-playing"), "false", "live demo suspends the illustrated tour");
  await page.getByRole("button", { name: "Close live terminal" }).click();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.ok(await page.getByRole("link", { name: "Open demo", exact: true }).evaluate((link) => link === document.activeElement), "closing restores focus");
  await page.goto(`${base}/more`);
  assert.equal(await page.getByRole("link", { name: /Built for automation/ }).getAttribute("href"), "https://docs.phux.sh/agents");
  assert.ok(await page.locator("#testflight form").isHidden(), "email is optional and does not summon a keyboard");
  await page.locator("#testflight [data-email-invite] > summary").click();
  await page.locator("#testflight input[name=email]").fill("more@example.com");
  await page.locator("#testflight button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#beta-note")?.textContent?.includes("Invite sent") ?? false);
  assert.equal(beta.payload?.email, "more@example.com", "/more still posts the TestFlight request");
  assert.ok(await page.locator("#beta form").isVisible(), "release signup is preserved");
  assert.equal(await page.locator("[data-copy]").count(), 2, "alternate installers preserved");
  assert.equal(await page.locator(".rune-install code").innerText(), "curl -fsSL https://phux.sh/install | sh -s -- --rune", "/more installs the Rune client");
  assert.match(await page.locator(".rune-install p").first().innerText(), /macOS 14 or later, or Linux on x86_64 or arm64\. Linux needs glibc 2\.39\+ \(Ubuntu 24\.04\+\), Vulkan, libxkbcommon-x11\. /);
  assert.deepEqual(
    await page.locator(".rune-archives a").evaluateAll(links => links.map(link => link.getAttribute("href"))),
    ["/download/rune", "/download/rune/linux-x86_64", "/download/rune/linux-aarch64"],
    "/more offers every Rune build",
  );
  await page.goto(`${base}/privacy`);
  assert.equal(await page.getByRole("link", { name: "join the beta" }).getAttribute("href"), "/more#beta");
  assert.equal(await page.getByRole("link", { name: "request access to phux for iPhone" }).getAttribute("href"), "/more#testflight");
  await page.goto(`${base}/telemetry`);
  assert.equal(await page.getByRole("link", { name: "release mailing list" }).getAttribute("href"), "/more#beta");
  // Legacy live links now scroll to an inline workspace; neither hides the hero
  // nor allocates anything until the workspace itself is visible.
  await page.goto(`${base}/?hero=light`);
  const live = page.frameLocator("#home-light iframe");
  const hookLine = live.locator(".install-hook-line code");
  await hookLine.waitFor();
  const stillness = async () => page.locator("#home-light").evaluate((node) => Math.round(node.getBoundingClientRect().height));
  const settled = await stillness();
  await page.waitForTimeout(1500);
  assert.equal(await stillness(), settled, "the hero frame stays stable while its terminals connect");
  await verifyWorkspaceResize(page);
  await verifyWorkspaceInstallCopy(page);
  assert.equal(await live.locator(".install-hook-lede, .install-hook-proof, .live-session-hint").count(), 0, "the live hero has no surrounding marketing prose");
  await live.getByRole("button", { name: "iPhone" }).click();
  await live.locator("[data-email-invite] > summary").click();
  assert.ok(await live.locator(".install-hook-request input[name=email]").isVisible(), "the iPhone target requests TestFlight");
  assert.ok(await page.locator(".hero").isVisible(), "the live workspace never replaces the product introduction");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => !document.querySelector("#home-light iframe"));
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#home-light iframe").count(), 0, "scrolling away releases the iframe, GPU and disposable connection");
  await page.getByRole("link", { name: "Open the browser demo", exact: true }).click();
  await page.locator("#home-light iframe").waitFor();
  await page.frameLocator("#home-light iframe").locator(".install-hook").waitFor();
  assert.equal(await page.locator("#home-light iframe").count(), 1, "returning creates exactly one fresh workspace");

  await verifyTouchComparison(page, base, artifacts);
  await verifyHostedShell(page, base, artifacts);
  await verifyHomeAuthReturn(page, base);
  assert.deepEqual(errors, [], "no browser exceptions");
  await context.close();
  await verifyDeviceInstalls(browser, base, artifacts);
  await verifyLinuxRune(browser, base, artifacts);
  await verifyEmailFallback(browser, base);
  await verifyStaticHome(browser, base);
  console.log(`PASS home: real workspace captures, pointer/touch/keyboard reveal and enlargement, first-fold install, optional walkthrough, lazy workspace lifecycle, install/copy/beta, tour chapters/pause/focus, glass shell auth/failure recovery, mobile/tablet/desktop, reduced motion, no-JS, idle resource budget. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  server.stop(true);
}
