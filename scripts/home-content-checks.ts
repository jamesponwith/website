import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { HOME } from "../src/lib/site";

/** Product copy and metadata must agree, including the script-free document. */
export async function verifyHomeContent(page: Page) {
  assert.equal((await page.getByRole("heading", { level: 1 }).innerText()).replace(/\s+/g, " ").trim(), HOME.headline);
  assert.equal((await page.locator(".hero-description").innerText()).trim(), HOME.lede);
  assert.equal(await page.locator(".hero-eyebrow, .hero-body").count(), 0, "one statement and one paragraph, no stacked slogans");
  assert.match(await page.locator(".product-fit").innerText(), /With Crew/);
  assert.match(await page.locator(".crew-requirements").innerText(), /source checkout.*native missions.*Python 3\.9/);
  assert.doesNotMatch(await page.locator(".exhibit").allInnerTexts().then(text => text.join(" ")), /editor|Orca|compar(e|ison)/i, "show the product, not editor preference or a competitor pitch");
  assert.equal(await page.locator(".exhibit").count(), 4, "agents, scripting, machines, Crew");
  assert.equal(await page.locator(".exhibit .transcript").count(), 4, "every claim sits next to what phux prints");
  assert.match(await page.locator(".boundary").innerText(), /A server crash or machine reboot ends running programs/);
  const transcripts = (await page.locator(".exhibit pre").allTextContents()).join("\n");
  assert.match(transcripts, /web: needs you \(1 agent waiting\)/, "phux ls output as the CLI prints it");
  assert.match(transcripts, /phux agent wait --any --until blocked --timeout 600/);
  assert.match(transcripts, /exit=2 \(152ms\)/, "phux run reports the command's exit code");
  assert.match(await page.locator(".exhibit").nth(1).textContent() ?? "", /Automation cannot type into a pane you hold/);
  assert.equal(await page.locator('.product-fit a[href="https://docs.phux.sh/distros#included-distros"]').count(), 1);
  assert.match(await page.locator(".mission-brief").innerText(), /Example task.*configured Crew/);
  assert.equal(await page.locator(".try-link").getAttribute("aria-label"), "Open the browser demo");
  assert.equal((await page.locator("#workspace-title").innerText()).trim(), "Browser demo");
  assert.equal((await page.locator(".workspace-heading p").innerText()).trim(), "A disposable phux shell in your browser.");
  assert.equal((await page.locator(".closing-platforms").innerText()).trim(), "All platforms ↗");
  assert.equal(HOME.headline, "A terminal multiplexer that knows what your agents are doing.");
  assert.equal(await page.title(), HOME.title);
  assert.equal(HOME.title, "phux — a terminal multiplexer for AI coding agents");
  assert.match(HOME.title, /a terminal multiplexer for AI coding agents/);
  assert.equal(HOME.description, "A terminal multiplexer for AI coding agents. See which agent is working, idle, or waiting on you, and drive any terminal from code, on your own machines.");
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
