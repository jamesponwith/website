import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  frontmatterValue,
  laterLastmod,
  pageLastmods,
  repositoryShallow,
  sourceCommitDate,
  sourceLastmod,
  urlsMismatchingSource,
  urlsMissingLastmod,
  validLastmod,
} from "./sitemap-lastmod";

const page = `---
title: "Install"
sourcePath: "docs/install.md"
sourceBase: "https://github.com/no-phux/phux"
---
`;

describe("sitemap lastmod", () => {
  test("reads the quoted source path from synced frontmatter", () => {
    expect(frontmatterValue(page, "sourcePath")).toBe("docs/install.md");
    expect(frontmatterValue(page, "missing")).toBeUndefined();
    expect(frontmatterValue('sourcePath: "say \\"hi\\""', "sourcePath")).toBe('say "hi"');
  });

  test("a missing or shallow repository yields no date", () => {
    expect(repositoryShallow("/tmp/not-a-git-repo")).toBe(true);
    expect(sourceLastmod("/tmp/not-a-git-repo", "docs/install.md")).toBeUndefined();
    expect(sourceCommitDate("/tmp/not-a-git-repo/docs/install.md")).toBeUndefined();
  });

  test("rejects a lastmod more than a day ahead", () => {
    const now = Date.parse("2026-10-29T00:00:00Z");
    expect(validLastmod("2099-01-01T00:00:00Z", now)).toBeUndefined();
    expect(validLastmod("2026-10-30T00:00:01Z", now)).toBeUndefined();
    expect(validLastmod("2026-10-30T00:00:00Z", now)).toBe("2026-10-30T00:00:00Z");
    expect(validLastmod("2026-10-27T08:41:11+00:00", now)).toBe("2026-10-27T08:41:11+00:00");
  });

  test("rejects an impossible calendar day that Date.parse would roll over", () => {
    const now = Date.parse("2026-10-29T00:00:00Z");
    expect(Number.isFinite(Date.parse("2026-02-30T00:00:00Z"))).toBe(true);
    expect(validLastmod("2026-02-30T00:00:00Z", now)).toBeUndefined();
    expect(validLastmod("2026-04-31T00:00:00Z", now)).toBeUndefined();
    expect(validLastmod("2024-02-29T00:00:00Z", now)).toBe("2024-02-29T00:00:00Z");
    expect(validLastmod("2026-02-28T00:00:00Z", now)).toBe("2026-02-28T00:00:00Z");
  });

  test("a future sourceMtime is not emitted", () => {
    const root = mkdtempSync(join(tmpdir(), "lastmod-future-"));
    const synced = join(root, "src/content/docs/_synced");
    mkdirSync(synced, { recursive: true });
    writeFileSync(join(synced, "plugins.md"), `---
title: "Plugins"
sourcePath: "src/site-docs/plugins.md"
sourceBase: "https://github.com/no-phux/website"
sourceMtime: "2099-01-01T00:00:00Z"
---
`);
    expect(pageLastmods(root).has("/plugins")).toBe(false);
  });

  test("a lastmod that is not the source file's date fails, older or fresh but wrong", () => {
    const dates = new Map([["/plugins", "2026-10-27T00:00:00Z"]]);
    const stale = `<url><loc>https://docs.phux.sh/plugins</loc><lastmod>2020-01-01T00:00:00Z</lastmod></url>`;
    const wrong = `<url><loc>https://docs.phux.sh/plugins</loc><lastmod>2026-10-28T00:00:00Z</lastmod></url>`;
    const exact = `<url><loc>https://docs.phux.sh/plugins</loc><lastmod>2026-10-27T00:00:00Z</lastmod></url>`;
    const offset = `<url><loc>https://docs.phux.sh/plugins</loc><lastmod>2026-10-26T20:00:00-04:00</lastmod></url>`;
    expect(urlsMismatchingSource(stale, dates)).toEqual(["https://docs.phux.sh/plugins"]);
    expect(urlsMismatchingSource(wrong, dates)).toEqual(["https://docs.phux.sh/plugins"]);
    expect(urlsMismatchingSource(exact, dates)).toEqual([]);
    expect(urlsMismatchingSource(offset, dates)).toEqual([]);
  });

  test("a lastmod on a path no source dates is a mismatch, not a pass", () => {
    const dates = new Map([["/plugins", "2026-10-27T00:00:00Z"]]);
    const unmapped = `<url><loc>https://docs.phux.sh/ghost</loc><lastmod>2026-10-27T00:00:00Z</lastmod></url>`;
    const undated = `<url><loc>https://docs.phux.sh/ghost</loc></url>`;
    expect(urlsMismatchingSource(unmapped, dates)).toEqual(["https://docs.phux.sh/ghost"]);
    expect(urlsMismatchingSource(undated, dates)).toEqual([]);
  });

  test("compares committer instants across offsets", () => {
    // 03:19-04:00 is 07:19:35Z, one second after the Z timestamp. Text order picks the Z value.
    expect(laterLastmod("2026-10-28T07:19:34Z", "2026-10-28T03:19:35-04:00")).toBe("2026-10-28T03:19:35-04:00");
    expect(laterLastmod("2026-10-28T08:00:00Z", "2026-10-27T08:41:11+00:00")).toBe("2026-10-28T08:00:00Z");
    expect(laterLastmod(undefined, "not-a-date")).toBeUndefined();
  });

  test("names every sitemap entry that omits lastmod", () => {
    const xml = `<urlset>
<url><loc>https://docs.phux.sh/overview</loc><lastmod>2026-10-27T00:00:00Z</lastmod></url>
<url><loc>https://docs.phux.sh/performance</loc></url>
</urlset>
<sitemapindex>
  <sitemap><loc>https://phux.sh/sitemap-0.xml</loc></sitemap>
</sitemapindex>`;
    expect(urlsMissingLastmod(xml)).toEqual([
      "https://docs.phux.sh/performance",
      "https://phux.sh/sitemap-0.xml",
    ]);
  });

  test("sourceMtime from sync metadata dates a page when git history cannot", () => {
    const root = mkdtempSync(join(tmpdir(), "lastmod-"));
    const synced = join(root, "src/content/docs/_synced");
    mkdirSync(synced, { recursive: true });
    writeFileSync(join(synced, "agent-waiting.md"), `---
title: "Waiting"
sourcePath: "src/site-docs/agent-waiting.md"
sourceBase: "https://github.com/no-phux/website"
sourceMtime: "2026-10-27T08:41:11+00:00"
---
`);
    writeFileSync(join(synced, "orphan.md"), `---
title: "Orphan"
sourcePath: "docs/orphan.md"
---
`);
    const dates = pageLastmods(root);
    expect(dates.get("/agent-waiting")).toBe("2026-10-27T08:41:11+00:00");
    expect(dates.has("/orphan")).toBe(false);
  });

  test("a full website checkout dates every phux.sh page and the website-owned docs pages", () => {
    const root = join(import.meta.dir, "..");
    expect(repositoryShallow(root)).toBe(false);
    const dates = pageLastmods(root);
    for (const path of [
      "/", "/brand", "/connect", "/demos", "/demos/program-status-osc7501",
      "/more", "/phone", "/privacy", "/support", "/teams", "/telemetry",
      "/overview", "/performance",
    ]) {
      expect(dates.get(path), path).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    for (const file of [
      "src/site-docs/agent-waiting.md",
      "src/site-docs/pane-command.md",
      "src/site-docs/tailscale.md",
      "src/site-docs/terminal-mcp.md",
    ]) {
      expect(sourceCommitDate(join(root, file)), file).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
