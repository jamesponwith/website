/**
 * Host split for the static site worker.
 *
 * phux.sh is the product surface (landing, installers, live demo, demo library).
 * docs.phux.sh is the documentation surface (Fumadocs tree + /overview).
 *
 * Pure functions so unit tests do not need a Cloudflare runtime.
 */

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
  "/config",
  "/keys",
  "/tmux-import",
  "/themes",
  "/status-bar",
  "/hooks",
  "/plugins",
  "/distros",
  "/projects",
  "/omarchy",
  "/scripting",
  "/desktop-reviews",
  "/pane-command",
  "/agent-quickstart",
  "/agent-waiting",
  "/terminal-mcp",
  "/agents",
  "/acp",
  "/remote",
  "/tailscale",
  "/clients",
  "/desktop-capture",
  "/desktop-changes",
  "/desktop-panes",
  "/embedding",
  "/public-api",
  "/building",
  "/any-program-status",
  "/program-protocol",
  "/program-sequences",
  "/host-services",
  "/troubleshooting",
  "/reference",
  "/architecture",
  "/resource-kinds",
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
    // Astro emits /quickstart as a 200 meta-refresh. Answer the retired URL
    // with a real permanent redirect before that page can be served.
    if (isRetiredQuickstartPage(path)) {
      return redirectOn(DOCS_HOST, "/getting-started", url.search);
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

function isRetiredQuickstartPage(pathname: string): boolean {
  return (
    pathname === "/quickstart" ||
    pathname === "/quickstart/" ||
    pathname === "/quickstart.html" ||
    pathname === "/quickstart/index.html"
  );
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
