// Per-URL sitemap dates. The date is the source file's own committer time
// (`git log -1 --format=%cI`), or the same instant stored as sourceMtime when
// sync-docs read that file. One `git log -1` of a shallow checkout stamps
// every file with the tip commit, so a shallow repository yields no date.
// CI and site-deploy check this repo out with fetch-depth: 0. Build time is
// not a lastmod.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { phuxRoot } from "./phux-root";

const LASTMOD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

const shallow = new Map<string, boolean>();

export function repositoryShallow(repo: string): boolean {
  const cached = shallow.get(repo);
  if (cached !== undefined) return cached;
  let value = true;
  try {
    value = execFileSync("git", ["-C", repo, "rev-parse", "--is-shallow-repository"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "true";
  } catch {
    value = true;
  }
  shallow.set(repo, value);
  return value;
}

/**
 * A W3C / ISO-8601 instant on a real calendar day that is not more than a day
 * ahead of `now`. `Date.parse` rolls an impossible day such as 02-30 into the
 * next month instead of rejecting it, so the day is checked separately.
 */
export function validLastmod(value: string | undefined, now = Date.now()): string | undefined {
  if (!value || !LASTMOD.test(value)) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now + FUTURE_SLACK_MS) return undefined;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return undefined;
  return value;
}

/** The later instant. Offsets are compared as instants, not as text. */
export function laterLastmod(current: string | undefined, next: string | undefined): string | undefined {
  const left = validLastmod(current);
  const right = validLastmod(next);
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

/** Committer date of `file` in `repo`, or undefined when history cannot say. */
export function sourceLastmod(repo: string, file: string): string | undefined {
  if (repositoryShallow(repo)) return undefined;
  try {
    const date = execFileSync("git", ["-C", repo, "log", "-1", "--format=%cI", "--", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return validLastmod(date);
  } catch {
    return undefined;
  }
}

/** Committer date of an absolute source file, when its repository has history. */
export function sourceCommitDate(file: string): string | undefined {
  let top: string;
  try {
    top = execFileSync("git", ["-C", dirname(file), "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
  if (!top) return undefined;
  const spec = relative(top, resolve(file)).split("\\").join("/");
  if (!spec || spec.startsWith("../")) return undefined;
  return sourceLastmod(top, spec);
}

/**
 * Sitemap URLs whose lastmod is not that path's source date: a different
 * instant (older, or fresh but wrong), or a lastmod on a path no source dates.
 * Serialize copies the source instant verbatim, so equality is exact.
 */
export function urlsMismatchingSource(xml: string, dates: Map<string, string>): string[] {
  const mismatched: string[] = [];
  for (const match of xml.matchAll(/<url>[\s\S]*?<\/url>/g)) {
    const block = match[0];
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
    if (!loc || !lastmod) continue;
    let path: string;
    try {
      path = new URL(loc).pathname;
    } catch {
      continue;
    }
    const source = dates.get(path);
    if (source && Date.parse(lastmod) === Date.parse(source)) continue;
    mismatched.push(loc);
  }
  return mismatched;
}

/** `<loc>` values whose `<url>` or `<sitemap>` block has no lastmod. */
export function urlsMissingLastmod(xml: string): string[] {
  const missing: string[] = [];
  for (const match of xml.matchAll(/<(url|sitemap)>[\s\S]*?<\/\1>/g)) {
    const block = match[0];
    if (block.match(/<lastmod>[^<]+<\/lastmod>/)) continue;
    missing.push(block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "(no loc)");
  }
  return missing;
}

export function frontmatterValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}: "((?:\\\\.|[^"\\\\])*)"`, "m"));
  if (!match?.[1]) return undefined;
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** pathname → ISO-8601 committer date. Missing entries are left out of the sitemap. */
export function pageLastmods(siteRoot: string): Map<string, string> {
  const dates = new Map<string, string>();
  let docsRoot: string | undefined;
  try {
    docsRoot = phuxRoot(siteRoot);
  } catch {
    docsRoot = undefined;
  }
  const synced = join(siteRoot, "src/content/docs/_synced");
  for (const file of walk(synced)) {
    if (!file.endsWith(".md")) continue;
    const text = readFileSync(file, "utf8");
    const sourcePath = frontmatterValue(text, "sourcePath");
    const sourceBase = frontmatterValue(text, "sourceBase") ?? "";
    const website = sourceBase.includes("github.com/no-phux/website") || (sourcePath ?? "").startsWith("src/");
    const repo = website ? siteRoot : docsRoot;
    // sourceMtime is the committer date sync-docs recorded from the source file.
    let date = validLastmod(frontmatterValue(text, "sourceMtime"));
    if (sourcePath && repo) date = laterLastmod(date, sourceLastmod(repo, sourcePath));
    if (!date) continue;
    const slug = relative(synced, file).replace(/\\/g, "/").replace(/\.md$/, "").replace(/\/index$/, "");
    dates.set(`/${slug}`, date);
  }
  for (const file of walk(join(siteRoot, "src/pages"))) {
    if (!file.endsWith(".astro") || file.includes("[")) continue;
    const rel = relative(join(siteRoot, "src/pages"), file).replace(/\\/g, "/").replace(/\.astro$/, "");
    const pathname = rel === "index" ? "/" : `/${rel.replace(/\/index$/, "")}`;
    if (dates.has(pathname)) continue;
    const date = sourceLastmod(siteRoot, relative(siteRoot, file));
    if (date) dates.set(pathname, date);
  }
  const demos = join(siteRoot, "src/content/demos");
  for (const file of walk(demos)) {
    if (!file.endsWith(".md")) continue;
    const slug = relative(demos, file).replace(/\\/g, "/").replace(/\.md$/, "");
    const date = sourceLastmod(siteRoot, relative(siteRoot, file));
    if (date) dates.set(`/demos/${slug}`, date);
  }
  // /performance publishes the measurements section of docs/compare.md.
  // /overview's copy lives in src/lib/site.ts as well as the page template.
  const performance = [
    dates.get("/performance"),
    sourceLastmod(siteRoot, "src/pages/performance.md.ts"),
    sourceLastmod(siteRoot, "src/lib/performance-page.ts"),
    docsRoot ? sourceLastmod(docsRoot, "docs/compare.md") : undefined,
  ].reduce(laterLastmod, undefined);
  if (performance) dates.set("/performance", performance);
  const overview = laterLastmod(dates.get("/overview"), sourceLastmod(siteRoot, "src/lib/site.ts"));
  if (overview) dates.set("/overview", overview);
  return dates;
}
