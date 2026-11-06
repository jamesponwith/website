import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DOCS_HOST,
  SITE_HOST,
  isConnectPath,
  isDocsHost,
  isDocsPath,
  isMarketingOnlyPath,
  routeRequest,
} from "./routes";

function urlOn(host: string, path: string): URL {
  return new URL(path, `https://${host}`);
}

describe("docs host detection", () => {
  test("matches the production docs hostname", () => {
    expect(isDocsHost(DOCS_HOST)).toBe(true);
    expect(isDocsHost("docs.phux.sh:443")).toBe(true);
    expect(isDocsHost("docs.preview.example")).toBe(true);
  });

  test("does not treat the marketing host or workers.dev as docs", () => {
    expect(isDocsHost(SITE_HOST)).toBe(false);
    expect(isDocsHost("www.phux.sh")).toBe(false);
    expect(isDocsHost("phux-site.account.workers.dev")).toBe(false);
    expect(isDocsHost("localhost")).toBe(false);
  });
});

describe("path classification", () => {
  test("docs prefixes include overview, guides, and search", () => {
    expect(isDocsPath("/overview")).toBe(true);
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/brand-assets"))).toEqual({ kind: "redirect", location: "https://docs.phux.sh/brand-assets", status: 301 });
    expect(isDocsPath("/quickstart/install")).toBe(true);
    expect(isDocsPath("/wire/l1")).toBe(true);
    expect(isDocsPath("/api/search.json")).toBe(true);
    expect(isDocsPath("/search.json")).toBe(true);
    expect(isDocsPath("/api/sections.json")).toBe(true);
    expect(isDocsPath("/consumers/cockpit")).toBe(true);
  });

  test("the agent search API keeps its query across the docs bounce", () => {
    expect(routeRequest("phux.sh", new URL("https://phux.sh/search.json?q=detach"))).toEqual({
      kind: "redirect",
      location: "https://docs.phux.sh/search.json?q=detach",
      status: 301,
    });
  });

  test("marketing paths stay off the docs host", () => {
    expect(isDocsPath("/")).toBe(false);
    expect(isDocsPath("/embed")).toBe(false);
    expect(isDocsPath("/install")).toBe(false);
    expect(isDocsPath("/install-desktop.sh")).toBe(false);
    expect(isDocsPath("/og.png")).toBe(false);
    expect(isMarketingOnlyPath("/embed")).toBe(true);
    expect(isMarketingOnlyPath("/install.sh")).toBe(true);
    expect(isMarketingOnlyPath("/quickstart")).toBe(false);
  });
});

describe("host routing", () => {
  test("phux.computer aliases permanently redirect to HTTPS phux.sh with the URL intact", () => {
    for (const host of ["phux.computer", "www.phux.computer", "PHUX.COMPUTER:8080"]) {
      for (const path of ["/", "/install", "/overview.md?from=alias&x=a%2Fb", "/_astro/site.js", "/.well-known/apple-app-site-association", "//example.com/path?next=https%3A%2F%2Fexample.com"]) {
        const url = new URL(`http://${host}${path}`);
        expect(routeRequest(host, url)).toEqual({
          kind: "redirect", location: `https://phux.sh${path}`, status: 301,
        });
      }
    }
    expect(routeRequest("other.phux.computer", new URL("https://other.phux.computer/"))).toEqual({ kind: "asset" });
  });

  test("direct Markdown pages follow the same host split as HTML", () => {
    for (const path of ["/overview.md", "/quickstart.md", "/consumers/getting-started.md", "/wire/l1.md"]) {
      expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, `${path}?from=agent`))).toEqual({
        kind: "redirect", location: `https://${DOCS_HOST}${path}?from=agent`, status: 301,
      });
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, path))).toEqual({ kind: "asset" });
    }
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/.well-known/agent-skills/using-phux/SKILL.md"))).toEqual({ kind: "asset" });
  });

  test("docs.phux.sh/quickstart is a 301 to /getting-started", () => {
    for (const path of ["/quickstart", "/quickstart/", "/quickstart.html", "/quickstart/index.html"]) {
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, `${path}?from=search`))).toEqual({
        kind: "redirect",
        location: "https://docs.phux.sh/getting-started?from=search",
        status: 301,
      });
    }
    expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, "/quickstart/install"))).toEqual({ kind: "asset" });
    expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, "/quickstart.md"))).toEqual({ kind: "asset" });
  });

  test("docs.phux.sh/ becomes /overview", () => {
    expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, "/"))).toEqual({
      kind: "redirect",
      location: "https://docs.phux.sh/overview",
      status: 301,
    });
  });

  test("docs.phux.sh serves the docs tree as assets", () => {
    expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, "/overview"))).toEqual({ kind: "asset" });
    expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, "/wire/l1"))).toEqual({ kind: "asset" });
  });

  test("distributions use the docs origin for HTML and Markdown without swallowing sibling assets", () => {
    for (const path of ["/distros", "/distros.html", "/distros.md", "/distros/index.html"]) {
      expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, `${path}?from=guide`))).toEqual({
        kind: "redirect", location: `https://${DOCS_HOST}${path}?from=guide`, status: 301,
      });
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, path))).toEqual({ kind: "asset" });
    }
    expect(isDocsPath("/distros-old")).toBe(false);
    expect(isDocsPath("/distros.png")).toBe(false);
  });

  test("the Omarchy guide uses the docs origin without swallowing sibling assets", () => {
    for (const path of ["/omarchy", "/omarchy.md", "/omarchy/index.html"]) {
      expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, path))).toEqual({
        kind: "redirect", location: `https://${DOCS_HOST}${path}`, status: 301,
      });
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, path))).toEqual({ kind: "asset" });
    }
    expect(isDocsPath("/omarchy-old")).toBe(false);
  });

  test("tmux import uses the docs origin for HTML and Markdown without swallowing sibling assets", () => {
    for (const path of ["/tmux-import", "/tmux-import/", "/tmux-import.html", "/tmux-import.md", "/tmux-import/index.html"]) {
      for (const host of [SITE_HOST, `www.${SITE_HOST}`]) {
        expect(routeRequest(host, urlOn(host, `${path}?from=keys`))).toEqual({
          kind: "redirect", location: `https://${DOCS_HOST}${path}?from=keys`, status: 301,
        });
      }
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, path))).toEqual({ kind: "asset" });
      expect(routeRequest("phux-site.account.workers.dev", urlOn(SITE_HOST, path))).toEqual({ kind: "asset" });
    }
    for (const path of ["/tmux-import-old", "/tmux-import.png"]) {
      expect(isDocsPath(path)).toBe(false);
      expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, path))).toEqual({ kind: "asset" });
    }
  });

  test("docs.phux.sh sends installers and embed back to phux.sh", () => {
    expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, "/install"))).toEqual({
      kind: "redirect",
      location: "https://phux.sh/install",
      status: 301,
    });
    expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, "/embed"))).toEqual({
      kind: "redirect",
      location: "https://phux.sh/embed",
      status: 301,
    });
  });

  test("demo pages and media redirect only within the demos path boundary", () => {
    for (const path of [
      "/demos",
      "/demos/",
      "/demos.html",
      "/demos/index.html",
      "/demos/program-status-osc7501?from=docs",
      "/demos/program-status-osc7501.html",
      "/demos/program-status-osc7501/video.mp4",
      "/demos/program-status-osc7501/poster.webp",
      "/demos/program-status-osc7501/captions.vtt",
      "/demos/program-status-osc7501/session.cast",
    ]) {
      expect(isMarketingOnlyPath(urlOn(DOCS_HOST, path).pathname)).toBe(true);
      expect(isDocsPath(urlOn(SITE_HOST, path).pathname)).toBe(false);
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, path))).toEqual({
        kind: "redirect",
        location: `https://${SITE_HOST}${path}`,
        status: 301,
      });
      expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, path))).toEqual({ kind: "asset" });
      expect(routeRequest("phux-site.account.workers.dev", urlOn(SITE_HOST, path))).toEqual({ kind: "asset" });
    }
    for (const path of ["/demosphere", "/demos-old/video.mp4", "/demos.mp4"]) {
      expect(isMarketingOnlyPath(path)).toBe(false);
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, path))).toEqual({ kind: "asset" });
    }
  });

  test("phux.sh 301s docs paths onto docs.phux.sh", () => {
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/docs"))).toEqual({
      kind: "redirect",
      location: "https://docs.phux.sh/docs",
      status: 301,
    });
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/quickstart?from=hero"))).toEqual({
      kind: "redirect",
      location: "https://docs.phux.sh/quickstart?from=hero",
      status: 301,
    });
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/wire/l1"))).toEqual({
      kind: "redirect",
      location: "https://docs.phux.sh/wire/l1",
      status: 301,
    });
    expect(routeRequest(`www.${SITE_HOST}`, urlOn(`www.${SITE_HOST}`, "/docs"))).toEqual({
      kind: "redirect",
      location: "https://docs.phux.sh/docs",
      status: 301,
    });
  });

  test("evaluation and recovery pages use the docs origin without swallowing similarly named assets", () => {
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/performance?view=latency"))).toEqual({
      kind: "redirect",
      location: "https://docs.phux.sh/performance?view=latency",
      status: 301,
    });
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/troubleshooting"))).toEqual({
      kind: "redirect",
      location: "https://docs.phux.sh/troubleshooting",
      status: 301,
    });
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/performance-chart.svg"))).toEqual({ kind: "asset" });
  });

  test("phux.sh keeps the landing, installers, and embed", () => {
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/"))).toEqual({ kind: "asset" });
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/install"))).toEqual({ kind: "asset" });
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/embed"))).toEqual({ kind: "asset" });
    expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, "/og.png"))).toEqual({ kind: "asset" });
  });

  test("workers.dev preview serves every path so a single deploy can be reviewed", () => {
    const preview = "phux-site.account.workers.dev";
    expect(routeRequest(preview, urlOn(preview, "/"))).toEqual({ kind: "asset" });
    expect(routeRequest(preview, urlOn(preview, "/overview"))).toEqual({ kind: "asset" });
    expect(routeRequest(preview, urlOn(preview, "/quickstart"))).toEqual({ kind: "asset" });
  });
});


describe("public concept gallery", () => {
  test("keeps only the VGPU concept on the marketing host, including page aliases", () => {
    for (const path of ["/concepts/vgpu", "/concepts/vgpu/", "/concepts/vgpu.html", "/concepts/vgpu/index.html", "/concepts/vgpu.md"]) {
      expect(isDocsPath(path)).toBe(false);
      expect(isMarketingOnlyPath(path)).toBe(true);
      expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, `${path}?variant=combo`))).toEqual({ kind: "asset" });
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, `${path}?variant=combo`))).toEqual({
        kind: "redirect", location: `https://${SITE_HOST}${path}?variant=combo`, status: 301,
      });
    }
  });
  test("preserves the concepts documentation and similarly named pages", () => {
    for (const path of ["/concepts", "/concepts/sessions", "/concepts/vgpu-old", "/concepts/vgpu-notes.html"]) {
      expect(isDocsPath(path)).toBe(true);
      expect(isMarketingOnlyPath(path)).toBe(false);
      expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, path))).toEqual({
        kind: "redirect", location: `https://${DOCS_HOST}${path}`, status: 301,
      });
    }
  });
});

describe("published documentation boundaries", () => {
  test("flat task guides and installation stay on the docs host for every page suffix", () => {
    for (const page of ["acp", "embedding", "desktop-capture", "desktop-changes", "desktop-panes", "organization", "installation", "substrate", "public-api", "building", "any-program-status", "program-protocol", "program-sequences", "host-services", "pane-command", "agent-waiting", "terminal-mcp", "tailscale", "agent-quickstart", "libghostty"]) {
      for (const suffix of ["", "/", ".html", ".md", "/index.html"]) {
        const path = `/${page}${suffix}`;
        expect(isDocsPath(path)).toBe(true);
        expect(isMarketingOnlyPath(path)).toBe(false);
        expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, path))).toEqual({ kind: "asset" });
        expect(routeRequest(SITE_HOST, urlOn(SITE_HOST, path))).toEqual({
          kind: "redirect", location: `https://${DOCS_HOST}${path}`, status: 301,
        });
      }
    }
  });
  test("installer boundaries preserve scripts without capturing installation", () => {
    for (const path of ["/install", "/install.sh", "/install-desktop", "/install-desktop.sh", "/install/example"]) {
      expect(isMarketingOnlyPath(path)).toBe(true);
      expect(routeRequest(DOCS_HOST, urlOn(DOCS_HOST, path))).toEqual({
        kind: "redirect", location: `https://${SITE_HOST}${path}`, status: 301,
      });
    }
  });
});

describe("sitemap exclusions", () => {
  test("keeps the noindex pairing page out of the sitemap", () => {
    for (const path of ["/connect", "/connect/", "/connect.html", "/connect/index.html", "/connect.md"]) {
      expect(isConnectPath(path)).toBe(true);
    }
    for (const path of ["/", "/connection", "/connect-old", "/concepts/connect", "/embed", "/concepts/vgpu"]) {
      expect(isConnectPath(path)).toBe(false);
    }
    const filter = readFileSync(new URL("../astro.config.mjs", import.meta.url), "utf8")
      .match(/filter: \(page\) => ([^\n]+)/)?.[1];
    expect(filter).toContain("!isEmbedPath(new URL(page).pathname)");
    expect(filter).toContain("!isVgpuConceptPath(new URL(page).pathname)");
    expect(filter).toContain("!isConnectPath(new URL(page).pathname)");
  });
});
