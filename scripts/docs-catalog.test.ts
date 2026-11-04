import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { discover } from "./docs-catalog";
import { writeDocumentation } from "./docs-output";
import { metadata, revision, siteRevision, source, state, useDocsSyncRoot, versions } from "./docs-sync.harness";

useDocsSyncRoot();

describe("documentation discovery interface", () => {
  test("keeps technical comparison metadata from the source rather than promoting another competitor pitch", async () => {
    await source("compare.md", "# phux vs tmux\n\nA source summary.\n\n## Next\n");
    const { entries } = await discover(state.docs);
    const comparison = entries.find(item => item.slug === "compare")!;
    expect(comparison.title).toBeUndefined();
    expect(comparison.summary).toBeUndefined();
  });
  test("keeps canonical flat guides and ignores the historical archive", async () => {
    const guides = ["embedding", "organization", "desktop-capture", "desktop-changes", "desktop-panes"];
    for (const guide of guides) await source(`${guide}.md`);
    await source("install.md");
    await source("README.md");
    await source("adr/README.md");
    await source("adr/old-decision.md");
    const { entries, excluded } = await discover(state.docs);
    expect(entries.map(({ slug }) => slug).sort()).toEqual(["docs", "installation", ...guides].sort());
    expect(entries.find(({ slug }) => slug === "installation")).toMatchObject({ repoPath: "docs/install.md", group: "start", order: 2 });
    expect(entries.find(({ slug }) => slug === "organization")).toMatchObject({ group: "internals", order: 2 });
    expect(excluded).toEqual([]);
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/clients.md");
  });

  test("publishes host services in Build for phux with local documentation links", async () => {
    for (const file of ["program-protocol.md", "program-sequences.md", "protocol.md"]) await source(file);
    await source("host-services.md", "# Host services\n\nHTTP over the phux connection.\n\n## Commands\n\nSee the [protocol](./protocol.md#commands-events-resources).\n");
    const { entries } = await discover(state.docs);
    expect(entries.find(({ slug }) => slug === "host-services")).toMatchObject({
      repoPath: "docs/host-services.md", group: "build", order: 2,
    });
    const out = join(state.root, "out");
    await mkdir(out);
    expect(await writeDocumentation(out, entries, revision, versions, siteRevision)).toEqual({ written: 9, failed: [] });
    expect((await metadata(out)).pages).toEqual([
      "---Get started---", "overview",
      "---Automate---", "pane-command", "agent-waiting", "terminal-mcp",
      "---Machines and clients---", "tailscale",
      "---Build for phux---", "program-protocol", "program-sequences", "host-services",
      "---Work on phux---", "protocol",
    ]);
    const guide = await readFile(join(out, "host-services.md"), "utf8");
    expect(guide).toContain('sourcePath: "docs/host-services.md"');
    expect(guide).toContain("[protocol](/protocol#commands-events-resources)");
  });

  test("publishes distributions beside plugins in Customize with local guide links", async () => {
    await source("plugins.md", "# Plugins\n\nExtend phux.\n\n## More\n\nSee [Distributions](./distros.md).\n");
    await source("distros.md", "# Distributions\n\nPortable defaults.\n\n## Write a distro\n\nCompose [plugins](./plugins.md).\n");
    await source("projects.md");
    const { entries, excluded } = await discover(state.docs);
    expect(entries.find(({ slug }) => slug === "distros")).toMatchObject({
      repoPath: "docs/distros.md", group: "customize", order: 7,
    });
    expect(excluded).toEqual([]);
    const out = join(state.root, "out");
    await mkdir(out);
    expect(await writeDocumentation(out, entries, revision, versions, siteRevision)).toEqual({ written: 8, failed: [] });
    expect((await metadata(out)).pages).toEqual([
      "---Get started---", "overview", "---Customize---", "plugins", "distros", "projects",
      "---Automate---", "pane-command", "agent-waiting", "terminal-mcp",
      "---Machines and clients---", "tailscale",
    ]);
    expect(await readFile(join(out, "plugins.md"), "utf8")).toContain("[Distributions](/distros)");
    const guide = await readFile(join(out, "distros.md"), "utf8");
    expect(guide).toContain('title: "Distributions"');
    expect(guide).toContain('sourcePath: "docs/distros.md"');
    expect(guide).toContain("[plugins](/plugins)");
  });

  test("publishes tmux import after Keys in Customize with local guide links", async () => {
    for (const file of ["config.md", "themes.md", "status-bar.md", "hooks.md", "plugins.md", "distros.md", "projects.md", "scripting.md"]) await source(file);
    await source("keys.md", "# Keys\n\nNative bindings.\n\n## Coming from tmux\n\nSee the [tmux importer guide](./tmux-import.md).\n");
    await source("getting-started.md", "# Getting started\n\nFirst steps.\n\n## Coming from tmux\n\nSee [Bring your tmux keys to phux](./tmux-import.md).\n");
    await source("tmux-import.md", "# Bring your tmux keys to phux\n\nImport native bindings.\n\n## Apply and undo\n\nSee [when settings take effect](./config.md#when-a-change-takes-effect) and the [JSON error contract](./scripting.md#json-output-and-errors).\n");
    const { entries, excluded } = await discover(state.docs);
    expect(entries.find(({ slug }) => slug === "tmux-import")).toMatchObject({
      repoPath: "docs/tmux-import.md", group: "customize", order: 2,
    });
    const customize = entries.filter(({ group }) => group === "customize").sort((a, b) => a.order - b.order);
    expect(customize.map(({ slug }) => slug)).toEqual([
      "config", "keys", "tmux-import", "themes", "status-bar", "hooks", "plugins", "distros", "projects",
    ]);
    expect(customize.map(({ order }) => order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(excluded).toEqual([]);
    const out = join(state.root, "out");
    await mkdir(out);
    expect(await writeDocumentation(out, entries, revision, versions, siteRevision)).toEqual({ written: 16, failed: [] });
    expect((await metadata(out)).pages).toEqual([
      "---Get started---", "overview", "getting-started", "---Customize---",
      "config", "keys", "tmux-import", "themes", "status-bar", "hooks", "plugins", "distros", "projects",
      "---Automate---", "pane-command", "scripting", "agent-waiting", "terminal-mcp",
      "---Machines and clients---", "tailscale",
    ]);
    expect(await readFile(join(out, "keys.md"), "utf8")).toContain("[tmux importer guide](/tmux-import)");
    expect(await readFile(join(out, "getting-started.md"), "utf8")).toContain("[Bring your tmux keys to phux](/tmux-import)");
    const guide = await readFile(join(out, "tmux-import.md"), "utf8");
    expect(guide).toContain('title: "Bring your tmux keys to phux"');
    expect(guide).toContain('sourcePath: "docs/tmux-import.md"');
    expect(guide).toContain("[when settings take effect](/config#when-a-change-takes-effect)");
    expect(guide).toContain("[JSON error contract](/scripting#json-output-and-errors)");
  });

  test("orders public section pages using all nav-order aliases, then basename", async () => {
    await source("reference/README.md");
    await source("reference/Beta.md", "---\nnav-order: -2\n---\n# Beta");
    await source("reference/Alpha.md", "---\nnav_order: 0\n---\n# Alpha");
    await source("reference/Delta.md", "---\nnavOrder: 0\n---\n# Delta");
    await source("reference/nested/Child.md", "---\nnavOrder: 2\n---\n# Child");
    await source("reference/nested/README.md");
    await source("reference/Zeta.md", "---\nnav-order: nope\nnav_order: -3\n---\n# Zeta");
    await source("reference/Aardvark.md");
    await source("reference/hidden.md", "---\nstability: DRAFT\nnav-order: -10\n---\n# Hidden");
    const { entries, excluded } = await discover(state.docs);
    expect(entries.filter(({ order }) => order > 0).sort((a, b) => a.order - b.order).map(({ slug }) => slug)).toEqual([
      "reference/beta", "reference/alpha", "reference/delta", "reference/nested/child", "reference/aardvark", "reference/zeta",
    ]);
    expect(entries.filter(({ order }) => order === 0).map(({ slug }) => slug).sort()).toEqual(["reference", "reference/nested"]);
    expect(excluded).toEqual(["docs/reference/hidden.md (stability:DRAFT)"]);
  });

  test("catalogs Build on phux ahead of the program protocol and skips a missing source", async () => {
    const absent = await discover(state.docs);
    expect(absent.entries.some(({ slug }) => slug === "building")).toBe(false);
    expect(absent.entries.some(({ slug }) => slug === "any-program-status")).toBe(false);
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/building.md");
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/any-program-status.md");

    await source("building.md", "# Build on phux\n\nPrograms that drive a phux server start here.\n");
    await source("any-program-status.md", "# Any program can report status\n\nA program reports with OSC 7501.\n");
    for (const file of ["program-protocol.md", "scripting.md", "agents.md", "protocol.md"]) await source(file);
    const { entries } = await discover(state.docs);
    expect(entries.find(({ slug }) => slug === "building")).toMatchObject({
      repoPath: "docs/building.md",
      slug: "building",
      group: "build",
      order: -1,
      title: "Build on phux",
    });
    expect(entries.find(({ slug }) => slug === "any-program-status")).toMatchObject({
      repoPath: "docs/any-program-status.md",
      slug: "any-program-status",
      group: "build",
      order: -0.5,
      title: "Any program can report status",
    });
    const out = join(state.root, "out");
    await mkdir(out);
    await writeDocumentation(out, entries, revision, versions, siteRevision);
    const pages = (await metadata(out)).pages as string[];
    expect(pages.indexOf("scripting")).toBeGreaterThan(-1);
    expect(pages.indexOf("agents")).toBeGreaterThan(pages.indexOf("scripting"));
    expect(pages.indexOf("---Build for phux---")).toBeGreaterThan(pages.indexOf("agents"));
    expect(pages.indexOf("building")).toBe(pages.indexOf("---Build for phux---") + 1);
    expect(pages.indexOf("any-program-status")).toBe(pages.indexOf("building") + 1);
    expect(pages.indexOf("program-protocol")).toBe(pages.indexOf("any-program-status") + 1);
    expect(pages.indexOf("protocol")).toBeGreaterThan(pages.indexOf("building"));
    const guide = await readFile(join(out, "building.md"), "utf8");
    expect(guide).toContain('title: "Build on phux"');
    expect(guide).toContain('sourcePath: "docs/building.md"');
    const status = await readFile(join(out, "any-program-status.md"), "utf8");
    expect(status).toContain('title: "Any program can report status"');
    expect(status).toContain('sourcePath: "docs/any-program-status.md"');
  });

  test("catalogs libghostty after architecture and skips a missing source", async () => {
    for (const file of ["architecture.md", "decisions.md", "protocol.md"]) await source(file);
    const absent = await discover(state.docs);
    expect(absent.entries.some(({ slug }) => slug === "libghostty")).toBe(false);
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/libghostty.md");

    await source("libghostty.md", "# libghostty\n\nThe terminal engine phux renders with.\n");
    const { entries } = await discover(state.docs);
    expect(entries.find(({ slug }) => slug === "libghostty")).toMatchObject({
      repoPath: "docs/libghostty.md",
      slug: "libghostty",
      group: "internals",
    });
    const out = join(state.root, "out");
    await mkdir(out);
    await writeDocumentation(out, entries, revision, versions, siteRevision);
    const pages = (await metadata(out)).pages as string[];
    expect(pages.indexOf("architecture")).toBeGreaterThan(-1);
    expect(pages.indexOf("libghostty")).toBe(pages.indexOf("architecture") + 1);
    expect(pages.indexOf("decisions")).toBe(pages.indexOf("libghostty") + 1);
  });

  test("syncs when neither new docs page is in the phux checkout yet", async () => {
    await source("program-protocol.md", "# Program protocol\n\nOSC 7501 keys.\n");
    const { entries } = await discover(state.docs);
    expect(entries.some(({ slug }) => slug === "building")).toBe(false);
    expect(entries.some(({ slug }) => slug === "any-program-status")).toBe(false);
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/building.md");
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/any-program-status.md");
    const out = join(state.root, "out");
    await mkdir(out);
    const result = await writeDocumentation(out, entries, revision, versions, siteRevision);
    expect(result.failed).toEqual([]);
    const pages = (await metadata(out)).pages as string[];
    expect(pages).toContain("program-protocol");
    expect(pages).not.toContain("building");
    expect(pages).not.toContain("any-program-status");
    const written = await readdir(out);
    expect(written).not.toContain("building.md");
    expect(written).not.toContain("any-program-status.md");
  });

  test("syncs when docs/any-program-status.md is not in the phux checkout yet", async () => {
    await source("building.md", "# Build on phux\n\nPrograms that drive a phux server start here.\n");
    await source("program-protocol.md", "# Program protocol\n\nOSC 7501 keys.\n");
    const { entries } = await discover(state.docs);
    expect(entries.some(({ slug }) => slug === "any-program-status")).toBe(false);
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/any-program-status.md");
    const out = join(state.root, "out");
    await mkdir(out);
    const result = await writeDocumentation(out, entries, revision, versions, siteRevision);
    expect(result.failed).toEqual([]);
    const pages = (await metadata(out)).pages as string[];
    expect(pages).toContain("building");
    expect(pages).toContain("program-protocol");
    expect(pages).not.toContain("any-program-status");
    expect(await readdir(out)).not.toContain("any-program-status.md");
  });

  test("syncs when docs/building.md is not in the phux checkout yet", async () => {
    await source("any-program-status.md", "# Any program can report status\n\nA program reports with OSC 7501.\n");
    await source("program-protocol.md", "# Program protocol\n\nOSC 7501 keys.\n");
    const { entries } = await discover(state.docs);
    expect(entries.some(({ slug }) => slug === "building")).toBe(false);
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/building.md");
    const out = join(state.root, "out");
    await mkdir(out);
    const result = await writeDocumentation(out, entries, revision, versions, siteRevision);
    expect(result.failed).toEqual([]);
    const pages = (await metadata(out)).pages as string[];
    expect(pages).toContain("any-program-status");
    expect(pages).toContain("program-protocol");
    expect(pages).not.toContain("building");
    expect(await readdir(out)).not.toContain("building.md");
  });

  test("accepts the phux main pages that landed ahead of the catalog PRs and skips a missing building page", async () => {
    const absent = await discover(state.docs);
    expect(absent.entries.some(({ slug }) => slug === "building")).toBe(false);
    expect(state.warning).toHaveBeenCalledWith("  skip (missing): docs/building.md");
    await source("public-api.md", "# Public terminal workflow\n\nCreate a terminal.\n");
    await source("any-program-status.md", "# Any program can report status\n\nOSC 7501.\n");
    await source("libghostty.md", "# libghostty in phux\n\nThe terminal engine.\n");
    const { entries } = await discover(state.docs);
    expect(entries.find(({ slug }) => slug === "public-api")).toMatchObject({ group: "automate", order: -0.5 });
    expect(entries.find(({ slug }) => slug === "any-program-status")).toMatchObject({ group: "build", order: -0.5, title: "Any program can report status" });
    expect(entries.find(({ slug }) => slug === "libghostty")).toMatchObject({ group: "internals", order: 0.5 });
    expect(entries.some(({ slug }) => slug === "building")).toBe(false);
  });

  test("fails visibly for an uncatalogued authored flat page", async () => {
    await source("future-guide.md");
    await expect(discover(state.docs)).rejects.toThrow("uncatalogued documentation: docs/future-guide.md; add it to ORIENTATION and navigation");
  });

  test("a denylisted flat page does not excuse another uncatalogued page", async () => {
    await source("substrate.md");
    await source("future-guide.md");
    await expect(discover(state.docs)).rejects.toThrow("uncatalogued documentation: docs/future-guide.md; add it to ORIENTATION and navigation");
  });

  test("excludes the internal substrate doc and emits no page or link to it", async () => {
    await source("substrate.md", "# Internal\n\nKeep off the site.\n");
    await source(
      "architecture.md",
      "# Architecture\n\nA public summary.\n\n## Detail\n\nSee the [record](./substrate.md#cut) and [remote](./remote.md).\n\n[hidden]: ./substrate.md\n",
    );
    await source("remote.md");
    const { entries, excluded } = await discover(state.docs);
    expect(entries.map(({ repoPath }) => repoPath)).not.toContain("docs/substrate.md");
    expect(entries.map(({ slug }) => slug)).not.toContain("substrate");
    expect(excluded).toContain("docs/substrate.md (denylist)");
    const out = join(state.root, "out");
    await mkdir(out);
    expect(await writeDocumentation(out, entries, revision, versions, siteRevision)).toEqual({ written: 7, failed: [] });
    const architecture = await readFile(join(out, "architecture.md"), "utf8");
    expect(architecture).toContain("See the record and [remote](/remote).");
    expect(architecture).not.toMatch(/substrate\.md|\/substrate/);
    expect(await readdir(out)).not.toContain("substrate.md");
    expect(JSON.stringify(await metadata(out))).not.toContain("substrate");
  });

  test("still excludes draft/scratch flat pages, including unknown work in progress", async () => {
    await source("clients.md", "---\nstability: draft\n---\n# Clients");
    await source("future-guide.md", "---\nstability: Scratch\n---\n# Future");
    const { entries, excluded } = await discover(state.docs);
    expect(entries).toEqual([]);
    expect(excluded.sort()).toEqual(["docs/clients.md (stability:draft)", "docs/future-guide.md (stability:Scratch)"]);
  });

  test("rejects colliding directory-index and page routes rather than overwriting", async () => {
    await source("reference/nested.md");
    await source("reference/nested/README.md");
    await expect(discover(state.docs)).rejects.toThrow("duplicate slug reference/nested");
  });
});
