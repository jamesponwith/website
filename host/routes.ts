/**
 * Host split for the static site worker.
 *
 * phux.sh is the product surface (landing, installers, live demo, demo library).
 * docs.phux.sh is the documentation surface (Fumadocs tree + /overview).
 *
 * Pure functions so unit tests do not need a Cloudflare runtime.
 */

import { WORKER_DOC_ALIASES, docsRedirects } from "./docs-redirects";

export const SITE_HOST = "phux.sh";
export const DOCS_HOST = "docs.phux.sh";
export const SITE_ALIASES = ["phux.computer", "www.phux.computer"] as const;

/** Paths that belong on docs.phux.sh. Prefix match, including the exact path. */
export const DOCS_PREFIXES = [
  "/overview",
  "/brand-assets",
  "/docs",
  "/installation",
  "/getting-started",
  "/concepts",
  "/compare",
  "/roadmap",
  "/config",
  "/keys",
  "/tmux-import",
  "/migrate",
  "/themes",
  "/status-bar",
  "/hooks",
  "/plugins",
  "/distros",
  "/projects",
  "/omarchy",
  "/scripting",
  "/pane-command",
  "/agent-quickstart",
  "/agent-waiting",
  "/terminal-mcp",
  "/agents",
  "/agent-skill",
  "/acp",
  "/approvals",
  "/remote",
  "/ssh",
  "/native-terminal",
  "/hub-mail",
  "/enterprise",
  "/audit",
  "/tailscale",
  "/clients",
  "/embedding",
  "/public-api",
  "/building",
  // Alias of /building. The worker 301s the page; Astro's redirect is the fallback.
  "/build-on",
  "/any-program-status",
  "/program-protocol",
  "/program-sequences",
  "/host-services",
  "/troubleshooting",
  "/reference",
  "/architecture",
  "/resource-kinds",
  "/mirrors",
  "/authority",
  "/applications",
  "/libghostty",
  "/decisions",
  "/organization",
  "/protocol",
  "/protocol-files",
  "/compatibility",
  "/development",
  "/mutation-testing",
  "/windows-desktop-development",
  "/releasing",
  "/substrate",
  // Pre-2026-10 docs URLs. Nested paths still use Astro's HTML redirects.
  // /quickstart itself is a worker 301 onto /getting-started.
  // A missing `<path>.md` for one of these aliases 301s to the canonical twin.
  "/quickstart",
  "/consumers",
  "/remote-access",
  "/performance",
  "/wire",
  "/decisions",
  "/api/search",
  "/api/search.json",
  "/api/sections.json",
  "/search.json",
] as const;

export type HostRoute =
  | { kind: "asset" }
  | { kind: "redirect"; location: string; status: 301 };

export function hostnameOf(host: string): string {
  return host.toLowerCase().split(":")[0] ?? host;
}

export function isDocsHost(host: string): boolean {
  const hostname = hostnameOf(host);
  return hostname === DOCS_HOST || hostname.startsWith("docs.");
}

export function isSiteHost(host: string): boolean {
  const hostname = hostnameOf(host);
  return hostname === SITE_HOST || hostname === `www.${SITE_HOST}`;
}

/** Docs requests for /sitemap-index.xml read the docs-host index, not phux.sh's. */
export function sitemapIndexAsset(host: string, pathname: string): string | undefined {
  if (isDocsHost(host) && pathname === "/sitemap-index.xml") return "/sitemap-docs-index.xml";
  return undefined;
}

export function isDocsPath(pathname: string): boolean {
  const path = stripPageSuffix(pathname);
  if (isVgpuConceptPath(path)) return false;
  return DOCS_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** One lowercase `.md` suffix on a single-slash docs path. Encoded or doubled suffixes are not aliases. */
const LITERAL_MARKDOWN_PATH = /^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md$/;

/**
 * Extensionless path for a docs-host `*.md` request that names a documentation
 * route. Catalog twins are built by `src/pages/[...slug].md.ts`.
 */
export function markdownFallbackPath(host: string, pathname: string): string | undefined {
  if (!isDocsHost(host) || !LITERAL_MARKDOWN_PATH.test(pathname)) return undefined;
  const path = pathname.slice(0, -".md".length);
  if (!isDocsPath(path) || isMarketingOnlyPath(path)) return undefined;
  return path;
}

export function isMarketingOnlyPath(pathname: string): boolean {
  const path = stripPageSuffix(pathname);
  return isVgpuConceptPath(path) || isEmbedPath(path) ||
    /^\/install(?:$|[./-])/.test(path) ||
    path === "/demos" || path.startsWith("/demos/");
}

export function routeRequest(host: string, url: URL): HostRoute {
  const path = url.pathname;

  if (SITE_ALIASES.some((alias) => alias === hostnameOf(host))) {
    const destination = new URL(url);
    destination.protocol = "https:";
    destination.host = SITE_HOST;
    destination.port = "";
    return { kind: "redirect", location: destination.href, status: 301 };
  }

  // /sitemap.xml was a 404; the generated file is /sitemap-index.xml.
  if (path === "/sitemap.xml") {
    const destinationHost = isDocsHost(host) ? DOCS_HOST : isSiteHost(host) ? SITE_HOST : hostnameOf(host);
    return redirectOn(destinationHost, "/sitemap-index.xml", url.search);
  }

  if (isDocsHost(host)) {
    if (path === "/" || path === "/index.html" || path === "") {
      return redirectOn(DOCS_HOST, "/overview", url.search);
    }
    // Astro emits these two as 200 meta-refresh pages. The target comes from
    // the same redirect map the HTML build uses.
    const aliasTarget = workerHtmlAliasTarget(path);
    if (aliasTarget) {
      return redirectOn(DOCS_HOST, aliasTarget, url.search);
    }
    if (isMarketingOnlyPath(path)) {
      return redirectOn(SITE_HOST, path, url.search);
    }
    return { kind: "asset" };
  }

  // Only the production marketing host bounces docs paths. Preview
  // (workers.dev) and local dev serve the whole tree so a single
  // deploy can be reviewed.
  if (isSiteHost(host) && isDocsPath(path)) {
    return redirectOn(DOCS_HOST, path, url.search);
  }
  return { kind: "asset" };
}

export function isEmbedPath(pathname: string): boolean {
  const path = stripPageSuffix(pathname);
  return path === "/embed" || path.startsWith("/embed/");
}

/** Pairing Universal Link. The page is noindex; the URL can carry a bearer token. */
export function isConnectPath(pathname: string): boolean {
  const path = stripPageSuffix(pathname);
  return path === "/connect" || path === "/connect/";
}

export function isVgpuConceptPath(pathname: string): boolean {
  const path = stripPageSuffix(pathname);
  return path === "/concepts/vgpu" || path.startsWith("/concepts/vgpu/");
}

/** HTML forms of the worker aliases. Targets are `docsRedirects()`, not a second copy of the paths. */
function workerHtmlAliasTarget(pathname: string): string | undefined {
  const redirects = docsRedirects(true);
  for (const alias of Object.keys(WORKER_DOC_ALIASES)) {
    if (
      pathname === alias ||
      pathname === `${alias}/` ||
      pathname === `${alias}.html` ||
      pathname === `${alias}/index.html`
    ) {
      return redirects[alias];
    }
  }
  return undefined;
}

function redirectOn(host: string, path: string, search: string): HostRoute {
  const location = new URL(path, `https://${host}`);
  location.search = search;
  return { kind: "redirect", location: location.href, status: 301 };
}

function stripPageSuffix(pathname: string): string {
  if (pathname.endsWith("/index.html")) {
    const trimmed = pathname.slice(0, -"/index.html".length);
    return trimmed === "" ? "/" : trimmed;
  }
  if (pathname.endsWith(".html")) return pathname.slice(0, -".html".length);
  if (pathname.endsWith(".md")) return pathname.slice(0, -".md".length);
  return pathname;
}
