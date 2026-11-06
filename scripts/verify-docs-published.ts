// The checks `verify:docs` runs against the built dist before a browser is
// involved: discovery files, sitemaps and their lastmods, crawl metadata.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import handler from "../host/index";
import { DOCS_HOST, SITE_HOST } from "../host/routes";
import { SITE } from "../src/lib/site";
import { SHIPPED_OPERATING_SYSTEM } from "../src/lib/software-application";
import { loadCompareMarkdown, measurementParagraphs, measurementsSection } from "../src/lib/performance-page";
import { GATED_LLMS_PAGES, llmsTxtListsPage } from "./publish-llms";
import { pageLastmods, urlsMismatchingSource, urlsMissingLastmod, validLastmod } from "./sitemap-lastmod";

export const root = resolve(import.meta.dir, "../dist");
export const types: Record<string, string> = {
  ".html": "text/html", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain",
  ".json": "application/json", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png",
};
export async function asset(request: Request) {
  const pathname = new URL(request.url).pathname;
  let path = resolve(root, `.${pathname}`);
  if (!path.startsWith(`${root}/`)) return new Response(null, { status: 403 });
  if (!extname(path)) path += ".html";
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response(null, { status: 404 });
  return new Response(request.method === "HEAD" ? null : file, {
    headers: { "content-type": types[extname(path)] ?? file.type },
  });
}

export async function verifyDiscovery() {
  const skills = JSON.parse(await readFile(resolve(root, ".well-known/agent-skills/index.json"), "utf8"));
  assert.deepEqual(skills.skills.map((skill: { name: string }) => skill.name), ["using-phux", "using-phux-mcp", "using-phux-tools"]);
  for (const skill of skills.skills) {
    const body = await readFile(resolve(root, `.${skill.url}`));
    assert.equal(`sha256:${createHash("sha256").update(body).digest("hex")}`, skill.digest);
  }
  const catalog = JSON.parse(await readFile(resolve(root, ".well-known/ai-catalog.json"), "utf8"));
  const llms = await readFile(resolve(root, "llms.txt"), "utf8");
  assert.ok(llms.startsWith(`# phux\n\n> ${SITE.tagline}\n`), "llms.txt leads with the canonical one-liner");
  assert.equal(llms.includes("programmable terminal runtime"), false, "llms.txt does not open on the old category line");
  for (const path of [
    "/compare", "/tmux-import", "/performance",
    "/program-protocol", "/program-sequences", "/plugins",
    "/embedding", "/protocol", "/agent-waiting",
    "/pane-command", "/terminal-mcp", "/tailscale",
  ]) {
    assert.ok(llms.includes(`https://${DOCS_HOST}${path}`), `llms.txt indexes ${path}`);
  }
  for (const line of [
    "- [OSC 7501: report status from any program](https://docs.phux.sh/program-protocol): the Program Status Protocol sequence a program writes to report its status; phux records it and shows it per pane.",
    "- [Program sequences and agent reports](https://docs.phux.sh/program-sequences): titles, `phux-ask` questions, OSC 133, OSC 52, and the other sequences phux reads, plus the agent record.",
    "- [Plugin API](https://docs.phux.sh/plugins): a directory with a `phux-plugin.toml` manifest that adds actions, panes, sidebar sections, status-bar widgets, themes, hooks, and agent declarations.",
    "- [Embed phux](https://docs.phux.sh/embedding): put a phux terminal in your own app with `phux-gpui`, `phux-client-runtime`, or `phux-client-ffi`. None is on crates.io yet.",
    "- [Server protocol](https://docs.phux.sh/protocol): how a client talks to a phux server in length-prefixed frames, with the handshake, capabilities, and the 1.x compatibility rule.",
    "- [Know when Claude Code or Codex is waiting for you](https://docs.phux.sh/agent-waiting): `phux agent list` prints each pane's agent state; `blocked` means Claude Code, Codex, or another recognized agent is waiting on you.",
    "- [Run a command in a pane and get its output and exit code](https://docs.phux.sh/pane-command): `phux run` types a command into a pane, waits, and exits with its status; includes a tmux mapping table.",
    "- [Give your agent a terminal over MCP](https://docs.phux.sh/terminal-mcp): register `phux mcp`, the MCP server built into phux, so your agent can drive local panes.",
    "- [Reach your coding agents over Tailscale and SSH](https://docs.phux.sh/tailscale): list tailnet machines with `phux host discover`, or add one over SSH, then `phux attach`.",
  ]) {
    assert.ok(llms.includes(line), `llms.txt line: ${line}`);
  }
  assert.ok(llms.includes("https://docs.phux.sh/agents.md"), "Markdown entrypoint is a published route");
  for (const skill of skills.skills) {
    assert.ok(catalog.entries.some((entry: { url: string }) => entry.url.endsWith(skill.url)));
    assert.ok(llms.includes(skill.name));
  }
  for (const page of GATED_LLMS_PAGES) {
    const built = existsSync(resolve(root, page.html));
    assert.equal(
      llmsTxtListsPage(llms, page.pathname),
      built,
      built
        ? `llms.txt omits ${page.pathname} although ${page.html} was built`
        : `llms.txt lists ${page.pathname} although ${page.html} was not built`,
    );
  }
  for (const match of llms.matchAll(/\]\((https:\/\/(?:docs\.)?phux\.sh[^)]+)\)/g)) {
    const path = new URL(match[1]!).pathname;
    if (path === "/mcp") continue;
    const response = await asset(new Request(`http://localhost${path}`));
    assert.ok(response.ok, `llms.txt link resolves: ${path}`);
  }
}

export async function sitemapFiles(pattern: RegExp): Promise<{ name: string; xml: string }[]> {
  const names = (await readdir(root)).filter((name) => pattern.test(name)).sort();
  return Promise.all(names.map(async (name) => ({ name, xml: await readFile(resolve(root, name), "utf8") })));
}

export function assertLastmodsDiffer(xml: string, label: string) {
  const blocks = [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].map((match) => match[0]);
  const dates = blocks
    .map((block) => block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1])
    .filter((date): date is string => Boolean(date));
  if (dates.length > 1 && new Set(dates).size === 1) {
    assert.fail(`${label}: every dated URL shares lastmod ${dates[0]}`);
  }
}

const sourceDates = pageLastmods(resolve(import.meta.dir, ".."));

export function assertEveryLastmod(xml: string, label: string) {
  const missing = urlsMissingLastmod(xml);
  assert.deepEqual(missing, [], `${label}: missing lastmod for ${missing.join(", ")}`);
  const invalid = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)]
    .map((match) => match[1]!)
    .filter((date) => validLastmod(date) === undefined);
  assert.deepEqual(invalid, [], `${label}: lastmod in the future or not a calendar instant: ${invalid.join(", ")}`);
  assertLastmodsDiffer(xml, label);
  const mismatched = urlsMismatchingSource(xml, sourceDates);
  assert.deepEqual(mismatched, [], `${label}: lastmod is not the source file's date: ${mismatched.join(", ")}`);
}

export async function verifyCrawlMetadata(
  siteSitemaps: { name: string; xml: string }[],
  docsSitemaps: { name: string; xml: string }[],
) {
  const docsSitemap = docsSitemaps.map((file) => file.xml).join("\n");
  for (const file of siteSitemaps) {
    assert.equal(file.xml.includes(`https://${DOCS_HOST}/`), false, `${file.name} lists no docs URLs`);
    assertEveryLastmod(file.xml, file.name);
  }
  for (const file of docsSitemaps) assertEveryLastmod(file.xml, file.name);
  for (const name of ["sitemap-index.xml", "sitemap-docs-index.xml"]) {
    assertEveryLastmod(await readFile(resolve(root, name), "utf8"), name);
  }
  assert.ok(docsSitemap.includes(`<loc>https://${DOCS_HOST}/performance</loc>`), "docs sitemap includes /performance");
  const docsIndex = await readFile(resolve(root, "sitemap-docs-index.xml"), "utf8");
  for (const file of docsSitemaps) {
    assert.ok(docsIndex.includes(`<loc>https://${DOCS_HOST}/${file.name}</loc>`), `docs host index lists ${file.name}`);
  }
  assert.equal(docsIndex.includes("https://phux.sh/"), false, "the docs sitemap index stays on docs.phux.sh");
  const measurements = measurementsSection(loadCompareMarkdown(resolve(import.meta.dir, "..")) ?? "");
  assert.ok(measurements, "compare.md publishes a measurements section");
  const performanceMd = await readFile(resolve(root, "performance.md"), "utf8");
  assert.ok(performanceMd.includes(measurements!), "performance.md serves the published measurements");
  assert.ok(performanceMd.includes("](/compare)"), "performance.md points at the comparison");
  const paragraphs = measurementParagraphs(loadCompareMarkdown(resolve(import.meta.dir, "..")) ?? "");
  assert.ok(paragraphs.length > 1, "measurements stay separate paragraphs");
  const performanceHtml = await readFile(resolve(root, "performance.html"), "utf8");
  for (const paragraph of paragraphs) {
    const opening = paragraph.slice(0, 48);
    assert.equal(performanceHtml.includes(`<p>${opening}`) || performanceHtml.includes(`<p>${opening.replace(/&/g, "&amp;")}`), true, `performance.html keeps a paragraph starting ${opening}`);
  }
  for (const file of ["index.html", "overview.html"]) {
    const html = await readFile(resolve(root, file), "utf8");
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(match, `${file}: SoftwareApplication JSON-LD`);
    const data = JSON.parse(match![1]!) as { "@graph"?: Record<string, unknown>[] };
    const application = data["@graph"]?.find((node) => node["@type"] === "SoftwareApplication");
    const source = data["@graph"]?.find((node) => node["@type"] === "SoftwareSourceCode");
    assert.ok(application, `${file}: SoftwareApplication node`);
    assert.equal(application?.["@id"], "https://phux.sh/#software");
    assert.equal(application?.name, "phux");
    assert.equal(application?.description, SITE.tagline);
    assert.equal(application?.url, SITE.url, `${file}: one canonical product url`);
    assert.equal(application?.applicationCategory, "DeveloperApplication");
    assert.equal(application?.operatingSystem, SHIPPED_OPERATING_SYSTEM);
    assert.equal(application?.license, "https://www.apache.org/licenses/LICENSE-2.0");
    assert.equal(application?.codeRepository, undefined, `${file}: codeRepository is not a SoftwareApplication property`);
    assert.equal(source?.codeRepository, "https://github.com/no-phux/phux");
    assert.deepEqual(source?.targetProduct, { "@id": "https://phux.sh/#software" });
    assert.deepEqual(application?.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" });
    assert.equal(typeof application?.softwareVersion, "string", `${file}: softwareVersion from this build`);
    assert.ok(!/iPhone|Android|phone/i.test(String(application?.operatingSystem)), `${file}: JSON-LD names shipped systems only`);
  }
  const overview = await readFile(resolve(root, "overview.html"), "utf8");
  assert.match(overview, /<title>Documentation overview — phux<\/title>/, "overview title names the page");
  const building = await readFile(resolve(root, "building.html"), "utf8");
  const buildingTitle = "Build on phux: JSON CLI, MCP, wire protocol, OSC 7501 and plugins";
  const buildingDescription = "Entry points for a program that drives a phux server or reports status into a pane: JSON CLI, MCP, the wire protocol, OSC 7501, and plugins.";
  assert.ok(building.includes(`<title>${buildingTitle}</title>`), "building title names the surfaces that exist");
  assert.ok(building.includes(`<meta property="og:title" content="${buildingTitle}"`));
  assert.ok(building.includes(`<meta name="twitter:title" content="${buildingTitle}"`));
  assert.ok(building.includes(`<meta name="description" content="${buildingDescription}"`));
  assert.doesNotMatch(buildingTitle + buildingDescription, /SDK|multi-client|hooks/i);
  const libghostty = await readFile(resolve(root, "libghostty.html"), "utf8");
  const libghosttyTitle = "A terminal multiplexer built on libghostty — phux";
  assert.ok(libghostty.includes(`<title>${libghosttyTitle}</title>`), "libghostty title names the multiplexer");
  assert.ok(libghostty.includes(`<meta property="og:title" content="${libghosttyTitle}"`));
  assert.ok(libghostty.includes(`<meta name="twitter:title" content="${libghosttyTitle}"`));
  const env = { ASSETS: { fetch: asset } };
  const docsIndexResponse = await handler.fetch(new Request(`https://${DOCS_HOST}/sitemap-index.xml`), env);
  assert.equal(docsIndexResponse.status, 200);
  assert.equal(await docsIndexResponse.text(), docsIndex, "docs.phux.sh/sitemap-index.xml is the docs index");
  for (const host of [SITE_HOST, DOCS_HOST]) {
    const response = await handler.fetch(new Request(`https://${host}/sitemap.xml`), env);
    assert.equal(response.status, 301, `${host}/sitemap.xml redirects`);
    assert.equal(response.headers.get("location"), `https://${host}/sitemap-index.xml`);
  }
  const performance = await handler.fetch(new Request(`https://${DOCS_HOST}/performance.md`), env);
  assert.equal(performance.status, 200, "/performance.md serves");
  assert.match(performance.headers.get("content-type") ?? "", /markdown/);
}
