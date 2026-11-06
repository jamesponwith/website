// public/llms.txt lists pages before phux publishes them.
// A build that skipped a page omits that page's line, so the published
// index does not point at a missing page. The next build that syncs the
// page keeps the line.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * One gate for every page that public/llms.txt may mention before phux
 * publishes it. `html` is the file this build emits for that page.
 */
export const GATED_LLMS_PAGES = [
  { pathname: "/building", html: "building.html" },
  { pathname: "/any-program-status", html: "any-program-status.html" },
  { pathname: "/libghostty", html: "libghostty.html" },
] as const;

const gatedHtml = new Map<string, string>(GATED_LLMS_PAGES.map((page) => [page.pathname, page.html]));
const docsUrl = /https?:\/\/docs\.phux\.sh[^)\s]*/g;

function pathnameOf(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.hostname !== "docs.phux.sh") return undefined;
  const path = url.pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** docs.phux.sh pathnames linked from one line, fragments stripped. */
export function docsPathnames(line: string): string[] {
  return [...line.matchAll(docsUrl)].flatMap((match) => {
    const path = pathnameOf(match[0]);
    return path ? [path] : [];
  });
}

export function llmsTxtListsPage(source: string, pathname: string): boolean {
  return source.split("\n").some((line) => docsPathnames(line).includes(pathname));
}

/** `presentHtml` is the set of gated HTML files this build actually wrote. */
export function llmsTxtForBuild(source: string, presentHtml: ReadonlySet<string>): string {
  return source
    .split("\n")
    .filter((line) => docsPathnames(line).every((pathname) => {
      const html = gatedHtml.get(pathname);
      return html === undefined || presentHtml.has(html);
    }))
    .join("\n");
}

export async function publishLlmsTxt(distDir: string): Promise<void> {
  const path = join(distDir, "llms.txt");
  const source = await readFile(path, "utf8");
  const presentHtml = new Set(
    GATED_LLMS_PAGES.filter((page) => existsSync(join(distDir, page.html))).map((page) => page.html),
  );
  const next = llmsTxtForBuild(source, presentHtml);
  if (next !== source) await writeFile(path, next);
}
