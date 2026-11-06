/** Source catalog and discovery policy for the documentation producer. */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

/** Nav groups, in sidebar render order. */
export const GROUPS = {
  start: "Get started",
  customize: "Customize",
  automate: "Automate",
  connect: "Machines and clients",
  build: "Build for phux",
  help: "Help",
  reference: "Reference",
  internals: "Work on phux",
} as const;
type Group = keyof typeof GROUPS;

export interface Entry {
  /** Source path relative to the phux REPO root, e.g. "docs/spec/L1.md". */
  repoPath: string;
  /** Absolute path on disk to read from. */
  abs: string;
  /** Site collection slug (also the URL tail). */
  slug: string;
  group: Group;
  order: number;
  /** Title override; otherwise derived from the H1. */
  title?: string;
  /** Metadata summary override for virtual pages. */
  summary?: string;
  /** Meta description override. The visible lede stays the source summary. */
  description?: string;
}

// ── frontmatter ──────────────────────────────────────────────────────────
interface SourceFm {
  body: string;
  meta: Record<string, string>;
}

export function parseFrontmatter(raw: string): SourceFm {
  if (!raw.startsWith("---\n")) return { body: raw, meta: {} };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { body: raw, meta: {} };
  const block = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const meta: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { body, meta };
}

// ── discovery ──────────────────────────────────────────────────────────────
/**
 * The hand-written pages, in nav order. Path is relative to DOCS_DIR.
 */
const ORIENTATION: { file: string; slug: string; group: Group; order: number; title?: string; description?: string }[] = [
  { file: "README.md", slug: "docs", group: "start", order: 9 },
  { file: "install.md", slug: "installation", group: "start", order: 2 },
  { file: "getting-started.md", slug: "getting-started", group: "start", order: 3 },
  { file: "concepts.md", slug: "concepts", group: "start", order: 4 },
  { file: "compare.md", slug: "compare", group: "start", order: 5 },
  { file: "config.md", slug: "config", group: "customize", order: 0 },
  { file: "keys.md", slug: "keys", group: "customize", order: 1 },
  { file: "tmux-import.md", slug: "tmux-import", group: "customize", order: 2 },
  { file: "themes.md", slug: "themes", group: "customize", order: 3 },
  { file: "status-bar.md", slug: "status-bar", group: "customize", order: 4 },
  { file: "hooks.md", slug: "hooks", group: "customize", order: 5 },
  { file: "plugins.md", slug: "plugins", group: "customize", order: 6 },
  { file: "distros.md", slug: "distros", group: "customize", order: 7 },
  { file: "projects.md", slug: "projects", group: "customize", order: 8 },
  { file: "omarchy.md", slug: "omarchy", group: "customize", order: 9 },
  { file: "public-api.md", slug: "public-api", group: "automate", order: -0.5 },
  { file: "agent-quickstart.md", slug: "agent-quickstart", group: "automate", order: 0 },
  { file: "scripting.md", slug: "scripting", group: "automate", order: 1 },
  { file: "agents.md", slug: "agents", group: "automate", order: 2 },
  { file: "acp.md", slug: "acp", group: "automate", order: 3 },
  { file: "remote.md", slug: "remote", group: "connect", order: 0 },
  { file: "clients.md", slug: "clients", group: "connect", order: 1 },
  { file: "desktop-capture.md", slug: "desktop-capture", group: "connect", order: 2 },
  { file: "desktop-changes.md", slug: "desktop-changes", group: "connect", order: 3 },
  { file: "desktop-panes.md", slug: "desktop-panes", group: "connect", order: 4 },
  { file: "desktop-reviews.md", slug: "desktop-reviews", group: "connect", order: 5 },
  // Hub for driving phux. A checkout without the file skips it.
  {
    file: "building.md",
    slug: "building",
    group: "build",
    order: -1,
    title: "Build on phux: JSON CLI, MCP, wire protocol, OSC 7501 and plugins",
    description: "Entry points for a program that drives a phux server or reports status into a pane: JSON CLI, MCP, the wire protocol, OSC 7501, and plugins.",
  },
  { file: "any-program-status.md", slug: "any-program-status", group: "build", order: -0.5, title: "Any program can report status" },
  { file: "program-protocol.md", slug: "program-protocol", group: "build", order: 0 },
  { file: "program-sequences.md", slug: "program-sequences", group: "build", order: 1 },
  { file: "host-services.md", slug: "host-services", group: "build", order: 2 },
  { file: "troubleshooting.md", slug: "troubleshooting", group: "help", order: 0 },
  { file: "architecture.md", slug: "architecture", group: "internals", order: 0 },
  { file: "resource-kinds.md", slug: "resource-kinds", group: "internals", order: 0.25 },
  { file: "libghostty.md", slug: "libghostty", group: "internals", order: 0.5, title: "A terminal multiplexer built on libghostty — phux" },
  { file: "decisions.md", slug: "decisions", group: "internals", order: 1 },
  { file: "organization.md", slug: "organization", group: "internals", order: 2 },
  { file: "protocol.md", slug: "protocol", group: "internals", order: 3 },
  { file: "protocol-files.md", slug: "protocol-files", group: "internals", order: 3.5 },
  { file: "compatibility.md", slug: "compatibility", group: "internals", order: 4 },
  { file: "embedding.md", slug: "embedding", group: "internals", order: 5 },
  { file: "development.md", slug: "development", group: "internals", order: 6 },
  { file: "mutation-testing.md", slug: "mutation-testing", group: "internals", order: 6.25 },
  { file: "windows-desktop-development.md", slug: "windows-desktop-development", group: "internals", order: 6.5 },
  { file: "releasing.md", slug: "releasing", group: "internals", order: 7 },
  { file: "substrate.md", slug: "substrate", group: "internals", order: 8 },
  { file: "brand-assets.md", slug: "brand-assets", group: "internals", order: 9 },
];

/** Reading order of the generated reference pages; unlisted ones follow alphabetically. */
const REFERENCE_ORDER = [
  "cli.md", "config.md", "keys.md", "actions.md", "widgets.md", "hooks.md",
  "environment.md", "exit-codes.md", "files.md", "kinds.md", "parity.md", "deprecations.md",
];

/**
 * Directory trees walked recursively. The directory's README becomes the
 * section index (bare slug, order 0); other files sort alphabetically by
 * basename after it.
 */
const SECTION_ROOTS: { dir: string; group: Group; urlPrefix: string }[] = [
  { dir: "reference", group: "reference", urlPrefix: "reference" },
];

/** Repo-relative paths that must never publish. */
const DENYLIST = new Set<string>([
  // Internal org-ops record synced from phux. Not a public guide.
  "docs/substrate.md",
]);

/** True when this repo-relative docs path must stay off the published site. */
export function isDeniedDocumentation(repoPath: string): boolean {
  return DENYLIST.has(repoPath);
}

/** Stability values that mark a doc as internal / unpublishable. */
const EXCLUDED_STABILITY = new Set(["scratch", "draft"]);

/** Recursively list all `*.md` files under `dir` (absolute paths). */
async function walkMd(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  const out = files.map((entry) => join(dir, entry.name));
  for (const entry of entries.filter((entry) => entry.isDirectory())) {
    out.push(...await walkMd(join(dir, entry.name)));
  }
  return out;
}

/** repoPath stays docs-relative even when PHUX_DOCS_DIR overrides the source. */
function docsRepoPath(docsDir: string, abs: string): string {
  return `docs/${relative(docsDir, abs).split(/[\\/]/).join("/")}`;
}

/** Returns the exclusion reason, or null to keep the candidate. */
function exclusionReason(repoPath: string, meta: Record<string, string>): string | null {
  if (isDeniedDocumentation(repoPath)) return "denylist";
  if (EXCLUDED_STABILITY.has((meta.stability ?? "").toLowerCase())) {
    return `stability:${meta.stability}`;
  }
  return null;
}

/** Numeric nav-order; absent/non-numeric values sort after explicit orders. */
function navOrder(meta: Record<string, string>): number {
  const raw = [meta["nav-order"], meta.nav_order, meta.navOrder].find((value) => value !== undefined);
  if (raw === undefined) return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Infinity;
}

interface Candidate {
  abs: string;
  repoPath: string;
  meta: Record<string, string>;
}

function candidateFromSource(docsDir: string, abs: string, raw: string, excluded: string[]): Candidate | null {
  const repoPath = docsRepoPath(docsDir, abs);
  const { meta } = parseFrontmatter(raw);
  const reason = exclusionReason(repoPath, meta);
  if (reason) {
    excluded.push(`${repoPath} (${reason})`);
    return null;
  }
  return { abs, repoPath, meta };
}

/** Fail at discovery, rather than silently dropping a new authored flat guide. */
async function validateFlatPages(docsDir: string, excluded: string[]): Promise<void> {
  const known = new Set(ORIENTATION.map(({ file }) => file));
  const files = (await readdir(docsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  for (const { name } of files) {
    if (known.has(name)) continue;
    const abs = join(docsDir, name);
    const candidate = candidateFromSource(docsDir, abs, await readFile(abs, "utf8"), excluded);
    if (candidate) throw new Error(`uncatalogued documentation: ${candidate.repoPath}; add it to ORIENTATION and navigation`);
  }
}

async function discoverOrientation(docsDir: string, excluded: string[]): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const { file, ...page } of ORIENTATION) {
    const abs = join(docsDir, file);
    // Orientation files historically warn and skip when absent.
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      console.warn(`  skip (missing): docs/${file}`);
      continue;
    }
    const candidate = candidateFromSource(docsDir, abs, raw, excluded);
    if (candidate) entries.push({ repoPath: candidate.repoPath, abs, ...page });
  }
  return entries;
}

/** Position in REFERENCE_ORDER; unlisted files sort after the listed ones. */
function referenceRank(abs: string): number {
  const rank = REFERENCE_ORDER.indexOf(basename(abs));
  return rank === -1 ? REFERENCE_ORDER.length : rank;
}

function compareNavOrder(a: Candidate, b: Candidate): number {
  const na = navOrder(a.meta);
  const nb = navOrder(b.meta);
  if (na !== nb) return na < nb ? -1 : 1;
  const ra = referenceRank(a.abs);
  const rb = referenceRank(b.abs);
  if (ra !== rb) return ra - rb;
  return basename(a.abs).localeCompare(basename(b.abs));
}

function sectionEntry(candidate: Candidate, root: typeof SECTION_ROOTS[number], rootDir: string, nonReadme: Candidate[]): Entry {
  const relInRoot = relative(rootDir, candidate.abs).split(/[\\/]/).join("/");
  const { abs, repoPath } = candidate;
  if (basename(abs).toLowerCase() === "readme.md") {
    // Nested READMEs keep their directory as the slug tail.
    const dir = dirname(relInRoot);
    const slug = dir === "." ? root.urlPrefix : `${root.urlPrefix}/${dir}`;
    return { repoPath, abs, slug, group: root.group, order: 0 };
  }
  const slug = `${root.urlPrefix}/${relInRoot.replace(/\.md$/, "").toLowerCase()}`;
  return { repoPath, abs, slug, group: root.group, order: nonReadme.indexOf(candidate) + 1 };
}

async function discoverSection(docsDir: string, root: typeof SECTION_ROOTS[number], excluded: string[]): Promise<Entry[]> {
  const rootDir = join(docsDir, root.dir);
  const files = (await walkMd(rootDir)).sort((a, b) => a.localeCompare(b));
  const kept: Candidate[] = [];
  for (const abs of files) {
    const candidate = candidateFromSource(docsDir, abs, await readFile(abs, "utf8"), excluded);
    if (candidate) kept.push(candidate);
  }
  const nonReadme = kept.filter(({ abs }) => basename(abs).toLowerCase() !== "readme.md");
  nonReadme.sort(compareNavOrder);
  return kept.map((candidate) => sectionEntry(candidate, root, rootDir, nonReadme));
}

/** One entry per slug; the same source may be discovered by multiple roots. */
function uniqueEntries(entries: Entry[]): Entry[] {
  const seen = new Map<string, string>();
  return entries.filter((entry) => {
    const previous = seen.get(entry.slug);
    if (previous && previous !== entry.repoPath) {
      throw new Error(`duplicate slug ${entry.slug}: ${previous} and ${entry.repoPath}`);
    }
    if (previous) return false;
    seen.set(entry.slug, entry.repoPath);
    return true;
  });
}

/** Discover public pages, retaining explicit routes/order and exclusion diagnostics. */
export async function discover(docsDir: string): Promise<{ entries: Entry[]; excluded: string[] }> {
  const excluded: string[] = [];
  await validateFlatPages(docsDir, excluded);
  const entries = await discoverOrientation(docsDir, excluded);
  for (const root of SECTION_ROOTS) {
    entries.push(...await discoverSection(docsDir, root, excluded));
  }
  return { entries: uniqueEntries(entries), excluded };
}
