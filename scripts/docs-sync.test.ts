import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discover, type Entry } from "./docs-catalog";
import { createPageRenderer } from "./docs-markdown";
import { writeDocumentation } from "./docs-output";
import { entry, metadata, render, revision, siteRevision, source, state, useDocsSyncRoot, versions } from "./docs-sync.harness";

useDocsSyncRoot();

describe("source Markdown rendering interface", () => {
  test("rewrites hosted routes, references, directories and unhosted sources with immutable provenance", () => {
    const hosted: Entry = { ...entry, repoPath: "docs/reference/CLI.md", slug: "reference/cli", group: "reference" };
    const body = "# Clients\n\nA summary.\n\n## Links\n\n" + [
      "[CLI](./reference/CLI.md#flags#extra)",
      "[Root](./README.md) [Reference](./reference/)",
      "[Source](../crates/phux/src/lib.rs#L1) [Tree](../crates/)",
      "[History](./adr/old.md) [Missing](./missing.md)",
      "[web](https://example.test/a.md) [secure](http://example.test) [mail](mailto:a@b.test) [local](#links)",
      '[ref]: ./reference/CLI.md#flags "CLI title"',
      "[single]: ./missing.md 'Source title'",
    ].join("\n");
    const text = render(body, [entry, hosted, { ...entry, repoPath: "docs/README.md", slug: "docs" }]);
    expect(text).toContain("[CLI](/reference/cli#flags#extra)");
    expect(text).toContain("[Root](/docs) [Reference](/reference)");
    expect(text).toContain(`[Source](https://github.com/no-phux/phux/blob/${revision}/crates/phux/src/lib.rs#L1)`);
    expect(text).toContain(`[Tree](https://github.com/no-phux/phux/tree/${revision}/crates)`);
    expect(text).toContain(`[History](https://github.com/no-phux/phux/blob/${revision}/docs/adr/old.md)`);
    expect(text).toContain('[ref]: /reference/cli#flags "CLI title"');
    expect(text).toContain(`[single]: https://github.com/no-phux/phux/blob/${revision}/docs/missing.md 'Source title'`);
    expect(text).toContain("[web](https://example.test/a.md) [secure](http://example.test) [mail](mailto:a@b.test) [local](#links)");
    expect(text).toContain(`sourcePath: "docs/clients.md"\nsourceRevision: "${revision}"`);
  });

  test("resolves links relative to nested source paths without sharing route state", () => {
    const nested = { ...entry, repoPath: "docs/reference/nested/page.md", slug: "reference/nested/page" };
    const raw = "# Nested\n\nSummary.\n\n## Links\n\n[Clients](../../clients.md#use) [Docs](../../)\n";
    const first = createPageRenderer([entry, nested], revision, versions);
    const other = createPageRenderer([nested], "c".repeat(40), versions);
    expect(other(raw, nested)).toContain(`/blob/${"c".repeat(40)}/docs/clients.md#use`);
    expect(first(raw, nested)).toContain("[Clients](/clients#use) [Docs](/docs)");
  });

  test("keeps code fences, whitespace and source-reference titles while stripping the shell-owned lead", () => {
    const code = '```sh\nprintf "%s\\n" "two  spaces"\n# not a heading\n```\n';
    const text = render(`# Clients\n\nA **formatted** summary with \`code\` and [links](./clients.md).\n\n## Commands\n\n${code}`);
    expect(text).toContain('title: "Clients"\nsummary: "A formatted summary with code and links."');
    expect(text.split("---\n").at(-1)).toBe(`## Commands\n\n${code}`);
  });

  test("honors metadata overrides, YAML escaping and safe stability defaults", () => {
    const override = { ...entry, title: 'A "quoted" \\ title', summary: "Owned summary." };
    const renderer = createPageRenderer([override], revision, versions);
    const text = renderer("---\nstability: internal\n---\n# Source title\n\nSource summary.\n\n## Details\n", override);
    expect(text).toContain('title: "A \\"quoted\\" \\\\ title"');
    expect(text).toContain('summary: "Owned summary."');
    expect(text).toContain('stability: "stable"');
    expect(render("---\nstability: evolving\n---\n# Source\n\nSummary.\n\n## Detail\n")).toContain('stability: "evolving"');
    expect(render("# Bare")).toContain('summary: ""');
  });
});

describe("collection output interface", () => {
  test("emits folder indexes, curated navigation and website-owned overview provenance", async () => {
    for (const file of ["README.md", "install.md", "config.md", "reference/README.md", "reference/zebra.md", "reference/cli.md", "reference/config.md"]) await source(file);
    const { entries } = await discover(state.docs);
    const out = join(state.root, "out");
    await mkdir(out);
    expect(await writeDocumentation(out, entries, revision, versions, siteRevision)).toEqual({ written: 12, failed: [] });
    expect(await readFile(join(out, "config.md"), "utf8")).toContain('sourcePath: "docs/config.md"');
    expect(await readFile(join(out, "reference/index.md"), "utf8")).toContain('sourcePath: "docs/reference/README.md"');
    expect(await metadata(out, "reference")).toEqual({ title: "Reference", pages: ["index", "cli", "config", "zebra"] });
    // One flat list from the catalog: the overview leads, the all-docs map closes Get started.
    expect(await metadata(out)).toEqual({
      pages: [
        "---Get started---", "overview", "installation", "docs", "---Customize---", "config",
        "---Automate---", "pane-command", "agent-waiting", "terminal-mcp",
        "---Machines and clients---", "tailscale",
        "---Reference---", "...reference",
      ],
    });
    const overview = await readFile(join(out, "overview.md"), "utf8");
    expect(overview).toContain(`sourcePath: "src/pages/overview.astro"\nsourceBase: "https://github.com/no-phux/website"\nsourceRevision: "${siteRevision}"`);
    expect(overview).toMatch(/sourceMtime: "\d{4}-\d{2}-\d{2}T[^"]+"/);
    expect(overview).toContain('protocolVersion: "1.2.3"\nprojectVersion: "0.4.5"');
    expect(overview).toContain("[Install phux](/installation)");
    const waiting = await readFile(join(out, "agent-waiting.md"), "utf8");
    expect(waiting).toContain('sourcePath: "src/site-docs/agent-waiting.md"\nsourceBase: "https://github.com/no-phux/website"');
    expect(waiting).toContain(`sourceRevision: "${siteRevision}"`);
    expect(waiting).toMatch(/sourceMtime: "\d{4}-\d{2}-\d{2}T[^"]+"/);
    expect(waiting.split("---").at(-1) ?? "").not.toMatch(/^# /m);
  });

  test("reports an unreadable source without masking write errors or dropping the overview", async () => {
    const out = join(state.root, "out");
    await mkdir(out);
    const missing = { ...entry, abs: join(state.root, "missing.md") };
    expect(await writeDocumentation(out, [missing], revision, versions, siteRevision)).toEqual({ written: 5, failed: ["docs/clients.md"] });
    expect(state.warning).toHaveBeenCalledWith("  fail (read):    docs/clients.md");
    const notDirectory = join(state.root, "not-a-directory");
    await writeFile(notDirectory, "occupied");
    await expect(writeDocumentation(notDirectory, [], revision, versions, siteRevision)).rejects.toThrow();
  });
});
