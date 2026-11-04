#!/usr/bin/env bun
/** Agent-facing docs acceptance against built assets, never a user's phux server. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import handler from "../host/index";
import { DOCS_HOST, SITE_HOST, routeRequest } from "../host/routes";
import { htmlToMarkdown } from "../host/markdown";
import { AGENT_START, OVERVIEW } from "../src/lib/site";
import { SITE_PAGE_CATALOG } from "./site-pages";
import { asset, root, sitemapFiles, verifyCrawlMetadata, verifyDiscovery } from "./verify-docs-published";

const useWebKit = process.argv.includes("--webkit");
const artifacts = resolve(import.meta.dir, "../.docs-check", useWebKit ? "webkit" : "chrome");
async function verifyPublishedPage(url: string, sitemap: string) {
  const markdown = await readFile(resolve(root, `.${url}.md`), "utf8");
  assert.ok(sitemap.includes(`<loc>https://${DOCS_HOST}${url}</loc>`), `${url}: canonical sitemap entry`);
  assert.match(markdown, /^---\n/);
  assert.match(markdown, /\n# .+/);
  const websitePages = new Set(["/overview", ...SITE_PAGE_CATALOG.map(({ slug }) => `/${slug}`)]);
  const repository = websitePages.has(url) ? "website" : "phux";
  assert.match(markdown, new RegExp(`source: "https://github.com/no-phux/${repository}/blob/[0-9a-f]{40}/`));
  assert.ok(!/^\w+: undefined$/m.test(markdown) && !markdown.endsWith("\n\nundefined"), `${url}: complete Markdown`);
  for (const suffix of ["", ".md"]) {
    const path = `${url}${suffix}`;
    assert.deepEqual(routeRequest(DOCS_HOST, new URL(path, `https://${DOCS_HOST}`)), { kind: "asset" }, `${path}: docs host`);
    assert.deepEqual(routeRequest(SITE_HOST, new URL(path, `https://${SITE_HOST}`)), {
      kind: "redirect", location: `https://${DOCS_HOST}${path}`, status: 301,
    }, `${path}: canonical host`);
  }
}

async function verifyOverview() {
  const overview = await readFile(resolve(root, "overview.md"), "utf8");
  const html = await readFile(resolve(root, "overview.html"), "utf8");
  assert.ok(overview.includes(AGENT_START.prompt));
  for (const { label, action, detail } of OVERVIEW.firstRun) {
    assert.ok(overview.includes(`**${label}:** \`${action}\` — ${detail}`), `overview Markdown shows ${label}`);
  }
  for (const text of [OVERVIEW.continuity, OVERVIEW.model]) {
    assert.ok(overview.includes(text), `overview Markdown: ${text}`);
    assert.ok(htmlToMarkdown(html).includes(text), `visible overview: ${text}`);
  }
  assert.ok(html.includes('href="/concepts#what-survives-what"'), "continuity uses the live Concepts heading");
  const concepts = await readFile(resolve(root, "concepts.html"), "utf8");
  assert.ok(concepts.includes('id="what-survives-what"'), "continuity heading exists");
  assert.ok(overview.includes("[All documentation](/docs)"));
  assert.ok(overview.includes("[Docs MCP (read-only)]"));
  const negotiated = htmlToMarkdown(html);
  assert.ok(negotiated.includes(AGENT_START.prompt), "negotiated Markdown retains the handoff");
  assert.ok(negotiated.includes("[All documentation](/docs)"), "negotiated Markdown retains reference links");
}

/** llms-full.txt carries every page in sidebar order; each page advertises its Markdown and card. */
async function verifyAgentSurfaces(pages: { url: string }[]) {
  const full = await readFile(resolve(root, "llms-full.txt"), "utf8");
  assert.match(full, /^# phux documentation\n/);
  for (const { url } of pages) {
    assert.ok(full.includes(`\nURL: https://${DOCS_HOST}${url}\n`), `llms-full.txt carries ${url}`);
  }
  const order = ["/overview", "/installation", "/docs"].map((url) => full.indexOf(`URL: https://${DOCS_HOST}${url}\n`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "llms-full.txt follows the sidebar order");
  assert.ok((await readFile(resolve(root, "llms.txt"), "utf8")).includes("https://docs.phux.sh/llms-full.txt"), "llms.txt points at llms-full.txt");
  const html = await readFile(resolve(root, "config.html"), "utf8");
  assert.ok(html.includes('<link rel="alternate" type="text/markdown" href="/config.md"'), "page advertises its Markdown");
  const card = new URL(html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? "missing");
  assert.equal(card.origin, `https://${DOCS_HOST}`, "social card uses the docs origin");
  assert.equal(card.pathname, "/og/config.png", "page has its own social card");
  assert.ok(card.searchParams.get("v"), "social card has a cache identity");
  assert.ok((await readFile(resolve(root, "og/config.png"))).subarray(1, 4).toString() === "PNG", "social card is a PNG");
}

/** The reader shell: catalog-ordered sidebar, outline, search keys, and the narrow drawer. */
async function verifyReaderShell(page: Page, base: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/config`);
  const sidebar = page.locator(".reader-sidebar");
  assert.equal(await sidebar.locator('a[aria-current="page"]').textContent(), (await page.locator("h1").first().textContent())?.trim());
  const firstGroup = await sidebar.locator(".reader-nav-group").first().locator(".reader-nav-link").evaluateAll(
    (links) => links.map((link) => link.getAttribute("href")),
  );
  assert.deepEqual(firstGroup.slice(0, 2), ["/overview", "/installation"], "the overview leads Get started, then install");
  assert.equal(firstGroup.at(-1), "/docs", "the all-docs map closes Get started");
  assert.ok(await sidebar.getByRole("list", { name: "On this page" }).locator("a").count() > 2, "active page shows its outline");
  await page.keyboard.press("/");
  await page.getByRole("dialog").locator("input").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.getByRole("dialog").locator("input").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });

  await page.setViewportSize({ width: 390, height: 844 });
  const opener = page.getByRole("button", { name: "Open navigation" });
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Documentation navigation" });
  await drawer.waitFor();
  assert.ok(await drawer.getByRole("button", { name: "Close navigation" }).evaluate((el) => el === document.activeElement), "drawer focuses Close");
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  assert.ok(await opener.evaluate((el) => el === document.activeElement), "closing the drawer returns focus");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no overflow at 390px");
}

/** GET /search.json through the host worker: every section deep-links into a built page. */
async function verifySearchApi(pages: { url: string }[]) {
  const env = { ASSETS: { fetch: asset } };
  const search = (query: string, init?: RequestInit) =>
    handler.fetch(new Request(`https://${DOCS_HOST}/search.json${query}`, init), env);
  type Hit = { url: string; markdown: string; page: string; heading: string; text: string };

  const all = await search("");
  assert.equal(all.status, 200);
  assert.equal(all.headers.get("access-control-allow-origin"), "*", "search is CORS-readable");
  assert.match(all.headers.get("cache-control") ?? "", /max-age=\d+/, "search is cacheable");
  const sections = (await all.json()) as Hit[];
  assert.ok(sections.length > pages.length, "every section, not every page");
  const html = new Map<string, string>();
  for (const section of sections) {
    assert.deepEqual(Object.keys(section).sort(), ["heading", "markdown", "page", "text", "url"]);
    const url = new URL(section.url);
    assert.equal(url.host, DOCS_HOST, `${section.url}: canonical docs URL`);
    assert.ok(pages.some((page) => page.url === url.pathname), `${section.url}: an indexed page`);
    assert.equal(section.markdown, `https://${DOCS_HOST}${url.pathname}.md${url.hash}`, `${section.url}: Markdown twin`);
    if (!html.has(url.pathname)) html.set(url.pathname, await readFile(resolve(root, `.${url.pathname}.html`), "utf8"));
    if (url.hash) {
      assert.ok(html.get(url.pathname)!.includes(`id="${url.hash.slice(1)}"`), `${section.url}: anchor exists`);
    }
  }

  const hits = (await (await search("?q=install+script")).json()) as Hit[];
  assert.ok(hits.length > 0 && hits.length <= 10, "at most ten results");
  assert.ok(hits.slice(0, 3).some((hit) => hit.url === `https://${DOCS_HOST}/installation#install-script`), "install script ranks near the top");
  const unbind = ((await (await search("?q=unbind+key")).json()) as Hit[]).map((hit) => hit.url);
  assert.equal(unbind[0], `https://${DOCS_HOST}/keys#removing-a-binding`, "content outranks the link lists that point at it");
  assert.equal((await search(`?q=${"a".repeat(201)}`)).status, 400, "an over-long q is refused");
  assert.equal((await search("", { method: "OPTIONS" })).status, 204, "CORS preflight");
  const bounced = await handler.fetch(new Request(`https://${SITE_HOST}/search.json?q=detach`), env);
  assert.equal(bounced.headers.get("location"), `https://${DOCS_HOST}/search.json?q=detach`, "phux.sh bounces search to the docs host");
  const llms = await readFile(resolve(root, "llms.txt"), "utf8");
  assert.ok(llms.includes(`https://${DOCS_HOST}/search.json?q=`), "llms.txt advertises search");
  assert.ok((await readFile(resolve(root, "overview.md"), "utf8")).includes(AGENT_START.search.example), "overview advertises search");
  return sections.length;
}

async function verifyPublishedContent() {
  const index = JSON.parse(await readFile(resolve(root, "api/mcp-search.json"), "utf8"));
  const pages = index.pages as { url: string }[];
  const siteSitemaps = await sitemapFiles(/^sitemap-\d+\.xml$/);
  const docsSitemaps = await sitemapFiles(/^sitemap-docs-\d+\.xml$/);
  const docsSitemap = docsSitemaps.map((file) => file.xml).join("\n");
  assert.ok(docsSitemaps.length > 0, "docs host sitemap exists");
  for (const { url } of pages) await verifyPublishedPage(url, docsSitemap);
  await verifyCrawlMetadata(siteSitemaps, docsSitemaps);
  // /decisions is the live constraints page; only the historical ADR archive stays out.
  assert.ok(pages.every(({ url }) => !/^\/(?:adr(?:\/|$)|decisions\/)/.test(url)), "historical ADRs are not live search pages");
  const clients = await readFile(resolve(root, "clients.md"), "utf8");
  assert.ok(pages.some(({ url }) => url === "/organization"), "organization: published and MCP-indexed");
  assert.ok(!pages.some(({ url }) => url === "/substrate"), "substrate: internal record stays unpublished");
  assert.ok(pages.some(({ url }) => url === "/acp"), "ACP: published and MCP-indexed");
  for (const slug of ["embedding", "desktop-capture", "desktop-changes", "desktop-panes"]) {
    assert.ok(pages.some(({ url }) => url === `/${slug}`), `${slug}: published and MCP-indexed`);
    assert.ok(clients.includes(`](/${slug}`), `${slug}: discoverable from Clients`);
  }
  await verifyOverview();
  await verifyDiscovery();
  await verifyAgentSurfaces(pages);
  return { pages: pages.length, sections: await verifySearchApi(pages) };
}

async function verifyPageCopy(page: Page, base: string, path: string) {
  await page.goto(`${base}${path}`);
  const actions = page.locator("[data-page-actions]");
  assert.equal(await actions.getByRole("link", { name: "View as Markdown" }).getAttribute("href"), `${path}.md`);
  await actions.getByRole("button", { name: "Copy page as Markdown" }).click();
  await actions.getByRole("status").filter({ hasText: "Page copied as Markdown." }).waitFor();
  assert.equal(await readClipboard(page), await readFile(resolve(root, `.${path}.md`), "utf8"));
}

async function readClipboard(page: Page): Promise<string> {
  if (!useWebKit) return page.evaluate(() => navigator.clipboard.readText());
  // WebKit cannot pre-grant clipboard permissions. Native paste also proves
  // the async write worked without asking a script to read the clipboard.
  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.id = "clipboard-check";
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  const text = await page.locator("#clipboard-check").inputValue();
  await page.locator("#clipboard-check").evaluate((input) => input.remove());
  return text;
}

const count = await verifyPublishedContent();
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch: (request) => handler.fetch(request, { ASSETS: { fetch: asset } }),
});
const base = `http://127.0.0.1:${server.port}`;
const browser = useWebKit
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: "chrome", headless: true });
try {
  await mkdir(artifacts, { recursive: true });
  const context = await browser.newContext(useWebKit ? {} : { permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await verifyPageCopy(page, base, "/overview");
  assert.equal(await page.locator(".overview-first-run-steps li").count(), 3);
  assert.equal(await page.getByRole("heading", { name: "Try it", exact: true }).count(), 1);
  assert.ok(await page.getByText("A terminal multiplexer whose server you can drive from code.", { exact: true }).isVisible());
  assert.ok(await page.getByText("A server crash or reboot ends it", { exact: false }).isVisible());
  assert.ok(await page.getByText("Sessions own resources. Arrangements place them. Views show them.", { exact: false }).isVisible());
  await page.getByRole("button", { name: "Copy agent prompt" }).click();
  await page.locator(".agent-prompt [role=status]").filter({ hasText: "Agent prompt copied." }).waitFor();
  assert.equal(await readClipboard(page), AGENT_START.prompt);
  assert.ok(await page.getByRole("link", { name: "Agent integrations" }).isVisible());
  assert.ok(await page.getByRole("link", { name: AGENT_START.search.example }).isVisible(), "overview shows the search API");
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    // Fumadocs switches its sidebar through matchMedia after the resize.
    // Wait for readable content width, rather than capturing the old grid.
    await page.waitForFunction(() => {
      const overview = document.querySelector(".docs-overview");
      return overview && overview.getBoundingClientRect().width >= 240;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`);
    assert.equal(await page.locator(".docs-overview").count(), 1, "one hydrated overview");
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight < 6000), `bounded page height at ${width}px`);
    await page.screenshot({ path: `${artifacts}/overview-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight < 6000), `screenshot does not alter layout at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "Reading theme" }).selectOption(theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${artifacts}/overview-${theme}.png`, fullPage: true });
  }
  for (const slug of ["desktop-capture", "desktop-changes", "desktop-panes", "embedding"]) {
    await page.goto(`${base}/clients`);
    await page.locator(`main a[href="/${slug}"]`).first().click();
    await page.waitForURL(`${base}/${slug}`);
    assert.ok(await page.getByRole("heading", { level: 1 }).isVisible(), `${slug}: readable task page`);
    await verifyPageCopy(page, base, `/${slug}`);
  }
  await page.goto(`${base}/agents`);
  await page.locator('main a[href="/acp"]').first().click();
  await page.waitForURL(`${base}/acp`);
  await verifyPageCopy(page, base, "/acp");
  await verifyPageCopy(page, base, "/agents");
  await verifyPageCopy(page, base, "/protocol");
  await page.route("**/protocol.md", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.getByRole("button", { name: "Copy page as Markdown" }).click();
  await page.locator("[data-page-actions] [role=status]").filter({ hasText: "View the Markdown" }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Copy page as Markdown" }).isEnabled(), "failure allows retry");
  await verifyReaderShell(page, base);
  assert.deepEqual(errors, [], "no browser exceptions");
  await context.close();

  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(`${base}/overview`);
  assert.equal(await staticPage.getByRole("heading", { name: "Try it", exact: true }).count(), 1);
  assert.ok(await staticPage.locator(".agent-prompt pre").isVisible());
  assert.equal(await staticPage.getByRole("link", { name: "View as Markdown" }).getAttribute("href"), "/overview.md");
  const markdown = await staticContext.request.get(`${base}/overview.md`);
  assert.ok(markdown.headers()["content-type"]?.includes("text/markdown"));
  assert.ok((await markdown.text()).includes(AGENT_START.prompt));
  await staticPage.getByRole("link", { name: "View as Markdown" }).click();
  await staticPage.waitForURL(`${base}/overview.md`, { timeout: 5000 });
  await staticPage.goto(`${base}/embedding`);
  assert.ok(await staticPage.getByRole("heading", { level: 1 }).isVisible(), "embedding is readable without JavaScript");
  assert.equal(await staticPage.getByRole("link", { name: "View as Markdown" }).getAttribute("href"), "/embedding.md");
  await staticContext.close();
  console.log(`PASS docs (${useWebKit ? "WebKit, no pre-granted clipboard permissions" : "Chrome"}): ${count.pages} Markdown pages, ${count.sections} search.json sections (anchors, ranking, limits, CORS), discovery links/digests, page and prompt copy, failure recovery, llms-full.txt, reader shell (nav order, outline, search keys, drawer focus), light/dark, 320/390/768/1280px, no-JS. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  server.stop(true);
}
