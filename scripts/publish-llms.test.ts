import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATED_LLMS_PAGES, docsPathnames, llmsTxtListsPage, publishLlmsTxt } from "./publish-llms";

const indexed = await readFile(new URL("../public/llms.txt", import.meta.url), "utf8");
const building = "/building";
const status = "/any-program-status";
const libghostty = "/libghostty";

async function publish(htmlFiles: string[], source = indexed): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), "phux-llms-"));
  try {
    await writeFile(join(dist, "llms.txt"), source);
    for (const name of htmlFiles) await writeFile(join(dist, name), "<!doctype html>");
    await publishLlmsTxt(dist);
    return await readFile(join(dist, "llms.txt"), "utf8");
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
}

describe("published llms.txt", () => {
  test("publishes neither gated llms.txt line when neither page is built", async () => {
    expect(llmsTxtListsPage(indexed, building)).toBe(true);
    expect(llmsTxtListsPage(indexed, status)).toBe(true);
    expect(llmsTxtListsPage(indexed, libghostty)).toBe(true);
    const published = await publish([]);
    expect(llmsTxtListsPage(published, building)).toBe(false);
    expect(llmsTxtListsPage(published, status)).toBe(false);
    expect(llmsTxtListsPage(published, libghostty)).toBe(false);
    expect(published).toContain("https://docs.phux.sh/protocol");
    expect(published).toContain("https://docs.phux.sh/scripting");
  });

  test("publishes only the building llms.txt line when only that page is built", async () => {
    const published = await publish(["building.html"]);
    expect(llmsTxtListsPage(published, building)).toBe(true);
    expect(llmsTxtListsPage(published, status)).toBe(false);
    expect(llmsTxtListsPage(published, libghostty)).toBe(false);
    expect(published).toContain("https://docs.phux.sh/protocol");
  });

  test("publishes only the any-program-status llms.txt line when only that page is built", async () => {
    const published = await publish(["any-program-status.html"]);
    expect(llmsTxtListsPage(published, building)).toBe(false);
    expect(llmsTxtListsPage(published, status)).toBe(true);
    expect(llmsTxtListsPage(published, libghostty)).toBe(false);
    expect(published).toContain("https://docs.phux.sh/scripting");
  });

  test("publishes every gated llms.txt line when every page is built", async () => {
    const published = await publish(["building.html", "any-program-status.html", "libghostty.html"]);
    expect(published).toBe(indexed);
    expect(llmsTxtListsPage(published, building)).toBe(true);
    expect(llmsTxtListsPage(published, status)).toBe(true);
    expect(llmsTxtListsPage(published, libghostty)).toBe(true);
  });

  test("omits a fragment link when that page HTML is absent", async () => {
    const source = indexed.replace(
      "](https://docs.phux.sh/building)",
      "](https://docs.phux.sh/building#entry-points)",
    );
    expect(llmsTxtListsPage(source, building)).toBe(true);
    const published = await publish(["any-program-status.html"], source);
    expect(llmsTxtListsPage(published, building)).toBe(false);
    expect(llmsTxtListsPage(published, status)).toBe(true);
  });

  test("a trailing slash, a query or a fragment still name the gated page", () => {
    for (const href of [
      "https://docs.phux.sh/building",
      "https://docs.phux.sh/building/",
      "https://docs.phux.sh/building?x=1",
      "https://docs.phux.sh/building/?x=1#entry-points",
    ]) {
      expect(docsPathnames(`- [Build on phux](${href}): the entry point.`), href).toEqual(["/building"]);
    }
    expect(docsPathnames("- [root](https://docs.phux.sh/)")).toEqual(["/"]);
    expect(docsPathnames("- [elsewhere](https://phux.sh/building/)")).toEqual([]);
  });

  test("the docs build calls publishLlmsTxt", async () => {
    const config = await readFile(new URL("../astro.config.mjs", import.meta.url), "utf8");
    expect(config).toContain("import { publishLlmsTxt } from \"./scripts/publish-llms.ts\"");
    expect(config).toMatch(/await publishLlmsTxt\(out\)/);
    expect(GATED_LLMS_PAGES.map((page) => page.html)).toEqual([
      "building.html",
      "any-program-status.html",
      "libghostty.html",
    ]);
  });
});
