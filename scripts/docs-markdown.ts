/** Source-page presentation and immutable, catalog-aware Markdown links. */
import { dirname, join } from "node:path";
import { extendComparePage } from "./compare-extension";
import { GROUPS, isDeniedDocumentation, parseFrontmatter, type Entry } from "./docs-catalog";
import { sourceCommitDate } from "./sitemap-lastmod";

export interface Versions { protocolVersion: string; projectVersion: string }

function siteRoute(slug: string): string {
  return slug === "" ? "/" : `/${slug}`;
}

function normalizeRepoPath(p: string): string {
  // Collapse ./ and ../ segments; strip leading ./
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function deriveTitle(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function deriveSummary(body: string): string | null {
  // The first paragraph after the H1: strip markdown emphasis, inline code
  // and links, collapse whitespace.
  const m = body.match(/^\s*#\s+.+\n+(?!<!--)([^\n#<][\s\S]*?)(?:\n\n|\n#|$(?![\s\S]))/);
  if (!m) return null;
  let s = m[1]
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

function deriveDescription(summary: string): string {
  if (summary.length <= 160) return summary;
  const sentence = summary.slice(0, 160).match(/^(.{60,}?[.!?])(?:\s|$)/)?.[1];
  return sentence ?? `${summary.slice(0, 157).replace(/\s+\S*$/, "")}...`;
}


/** The docs shell owns the page title and lede; avoid rendering source copies. */
function stripSourceLead(body: string): string {
  return body
    .replace(/^\s+/, "")
    .replace(/^#\s+.+\n+/, "")
    .replace(/^(?!<!--)[^\n#<][\s\S]*?\n\s*\n/, "")
    .replace(/^\s+/, "");
}

function presentBody(body: string): string {
  return stripSourceLead(body);
}

export function yamlString(s: string): string {
  // Always quote; escape backslashes and double-quotes for YAML double-quoted.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}


const SCHEMA_STABILITY = new Set(["stable", "evolving", "draft"]);

function isDirectoryPath(path: string): boolean {
  return path.endsWith("/") || !/\.[a-z0-9]+$/i.test(path);
}

function splitHref(href: string) {
  const hashIdx = href.indexOf("#");
  return {
    path: hashIdx === -1 ? href : href.slice(0, hashIdx),
    anchor: hashIdx === -1 ? "" : href.slice(hashIdx),
  };
}

function unhostedFile(path: string, resolved: string, anchor: string, blob: string): string | null {
  if (/\.(md|rs|toml|zig|sh|nix|ya?ml)$/.test(path) || resolved.includes("/")) {
    return `${blob}/${resolved}${anchor}`;
  }
  return null;
}

function isDeniedHref(href: string, fromDir: string): boolean {
  if (/^(https?:\/\/|#|mailto:)/.test(href)) return false;
  const { path } = splitHref(href);
  if (!path) return false;
  return isDeniedDocumentation(normalizeRepoPath(join(fromDir, path)));
}

/** Drop links to denylisted sources. The label stays; the target does not. */
function stripDeniedLinks(body: string, fromDir: string): string {
  const inline = body.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang, label, href) => {
    if (!isDeniedHref(href, fromDir)) return whole;
    return bang ? "" : label;
  });
  return inline.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+[^\n]*(?:\n|$)/gm, (line) => {
    const href = line.match(/\]:[ \t]*(\S+)/)?.[1];
    return href && isDeniedHref(href, fromDir) ? "" : line;
  });
}

/** A rewriter owns its route tables; concurrent producers cannot overwrite them. */
function createLinkRewriter(entries: Entry[], revision: string) {
  const byPath = new Map<string, string>();
  for (const entry of entries) {
    const repoPath = normalizeRepoPath(entry.repoPath);
    if (!byPath.has(repoPath)) byPath.set(repoPath, siteRoute(entry.slug));
  }
  const byDir = new Map([["docs", "/docs"], ["docs/reference", "/reference"]]);
  const blob = `https://github.com/no-phux/phux/blob/${revision}`;
  const tree = `https://github.com/no-phux/phux/tree/${revision}`;

  function directoryHref(resolved: string, anchor: string): string {
    return `${byDir.get(resolved) ?? `${tree}/${resolved}`}${anchor}`;
  }

  function resolveHref(href: string, fromDir: string): string | null {
    if (/^(https?:\/\/|#|mailto:)/.test(href)) return null;
    const { path, anchor } = splitHref(href);
    if (!path) return null;
    const resolved = normalizeRepoPath(join(fromDir, path));
    const route = byPath.get(resolved);
    if (route) return `${route}${anchor}`;
    if (isDirectoryPath(path)) return directoryHref(resolved, anchor);
    return unhostedFile(path, resolved, anchor, blob);
  }

  return function rewriteLinks(body: string, repoPath: string): string {
    const fromDir = dirname(repoPath);
    // Keep the existing inline/reference-definition passes byte-for-byte in
    // scope: this is not a Markdown parser or a renderer behavior change.
    let out = stripDeniedLinks(body, fromDir);
    out = out.replace(/(\]\()([^)\s]+)(\))/g, (whole, open, href, close) => {
      const next = resolveHref(href, fromDir);
      return next === null ? whole : `${open}${next}${close}`;
    });
    out = out.replace(
      /^([ \t]*\[[^\]]+\]:[ \t]*)(\S+)([ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\))?[ \t]*)$/gm,
      (whole, prefix, href, suffix) => {
        const next = resolveHref(href, fromDir);
        return next === null ? whole : `${prefix}${next}${suffix}`;
      },
    );
    return out;
  };
}

function schemaStability(meta: Record<string, string>): string {
  return SCHEMA_STABILITY.has((meta.stability ?? "").toLowerCase()) ? meta.stability : "stable";
}

function pageTitle(entry: Entry, body: string): string {
  return entry.title ?? deriveTitle(body) ?? entry.slug;
}

function pageSummary(entry: Entry, body: string): string {
  return entry.summary ?? deriveSummary(body) ?? "";
}

function pageMetadata(raw: string, entry: Entry) {
  const { body, meta } = parseFrontmatter(raw);
  const summary = pageSummary(entry, body);
  return {
    body,
    title: pageTitle(entry, body),
    summary,
    description: entry.description ?? deriveDescription(summary),
    stability: schemaStability(meta),
  };
}

/** Render with fixed source provenance; entries supply the hosted-link catalog. */
export function createPageRenderer(entries: Entry[], revision: string, versions: Versions) {
  const rewriteLinks = createLinkRewriter(entries, revision);
  return function renderSourcePage(raw: string, entry: Entry): string {
    const { body, title, summary, description, stability } = pageMetadata(raw, entry);
    const extended = entry.repoPath === "docs/compare.md" ? extendComparePage(body, revision) : body;
    const sourceMtime = sourceCommitDate(entry.abs);
    const fm = [
      "---",
      `title: ${yamlString(title)}`,
      `summary: ${yamlString(summary)}`,
      `description: ${yamlString(description)}`,
      `group: ${yamlString(GROUPS[entry.group])}`,
      `order: ${entry.order}`,
      `sourcePath: ${yamlString(entry.repoPath)}`,
      `sourceRevision: ${yamlString(revision)}`,
      ...(sourceMtime ? [`sourceMtime: ${yamlString(sourceMtime)}`] : []),
      `protocolVersion: ${yamlString(versions.protocolVersion)}`,
      `projectVersion: ${yamlString(versions.projectVersion)}`,
      `stability: ${yamlString(stability)}`,
      "---",
      "",
    ].join("\n");
    return fm + rewriteLinks(presentBody(extended), entry.repoPath);
  };
}
