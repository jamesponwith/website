import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { HOME } from "../src/lib/site";

/** Product copy and metadata must agree, including the script-free document. */
export async function verifyHomeContent(page: Page) {
  assert.equal((await page.getByRole("heading", { level: 1 }).innerText()).replace(/\s+/g, " ").trim(), HOME.headline);
  assert.equal((await page.locator(".hero-description").innerText()).trim(), "Your agents. Your machines. One workspace.");
  assert.match(await page.locator(".hero-body").innerText(), /Give agents the work/);
  assert.match(await page.locator(".workflow-proof").innerText(), /Delegate\. Supervise\. Unblock\. Review\./);
  assert.match(await page.locator(".product-fit").innerText(), /With Crew/);
  assert.match(await page.locator(".crew-requirements").innerText(), /source checkout.*native missions.*Python 3\.9/);
  assert.doesNotMatch(await page.locator(".workflow-proof, .product-fit").allInnerTexts().then(text => text.join(" ")), /editor|Orca|compar(e|ison)/i, "lead with agent work, not editor preference or a competitor pitch");
  assert.equal(await page.locator(".workflow-grid article").count(), 3);
  assert.match(await page.locator(".workflow-proof").innerText(), /A server crash or machine reboot ends running programs/);
  assert.equal(await page.locator(".control-proof").getAttribute("open"), null, "technical commands are optional, not the sales pitch");
  assert.match(await page.locator(".control-proof pre").textContent() ?? "", /phux agent wait --any --until blocked --timeout 600/);
  assert.match(await page.locator(".control-proof figcaption").textContent() ?? "", /not a live feed/);
  assert.match(await page.locator(".control-proof").textContent() ?? "", /Automation cannot type into a pane you hold/);
  assert.equal(await page.locator('.product-fit a[href="https://docs.phux.sh/distros#included-distros"]').count(), 1);
  assert.match(await page.locator(".mission-brief").innerText(), /Example task.*configured Crew/);
  assert.equal(await page.locator(".try-link").getAttribute("aria-label"), "Open the browser demo");
  assert.equal((await page.locator("#workspace-title").innerText()).trim(), "Browser demo");
  assert.equal((await page.locator(".workspace-heading p").innerText()).trim(), "A disposable phux shell in your browser.");
  assert.equal((await page.locator(".closing-platforms").innerText()).trim(), "All platforms ↗");
  assert.match((await page.getByRole("heading", { level: 1 }).innerText()).replace(/\s+/g, " "), /Run agents\. Stay in control\./);
  assert.equal(await page.title(), HOME.title);
  assert.equal(HOME.title, "phux — a terminal multiplexer for AI coding agents");
  assert.match(HOME.title, /a terminal multiplexer for AI coding agents/);
  assert.equal(HOME.description, "A terminal multiplexer for AI coding agents. Delegate work, supervise agents, resolve blockers, and review results on your own machines.");
  assert.equal(await page.locator('meta[property="og:title"]').getAttribute("content"), HOME.title);
  assert.equal(await page.locator('meta[name="twitter:title"]').getAttribute("content"), HOME.title);
  assert.match(HOME.description, /terminal multiplexer/);
  assert.match(HOME.description, /AI coding agents/);
  assert.equal(await page.locator('meta[name="description"]').getAttribute("content"), HOME.description);
  assert.equal(await page.locator('meta[property="og:description"]').getAttribute("content"), HOME.description);
  assert.equal(await page.locator('meta[name="twitter:description"]').getAttribute("content"), HOME.description);
  assert.equal((await page.locator(".download-note").innerText()).trim(), "Phux Rune · Apple silicon · macOS 14 or later · Apache-2.0 · No account");
  assert.equal(await page.locator(".cli-requirement").count(), 0);
}
