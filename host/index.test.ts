import { describe, expect, test } from "bun:test";
import handler from "./index";
import { sitemapIndexAsset } from "./routes";
import { rotationPayload } from "./tripwire-fixtures";

const PAGE = `<!doctype html><html><head><title>phux</title></head>
<body><main><h1>phux</h1><p>you and your agents share the same terminals</p></main></body></html>`;

function assetsOf(body: string, contentType = "text/html") {
  return {
    ASSETS: {
      fetch: async () =>
        new Response(body, { headers: { "content-type": contentType } }),
    },
  };
}

describe("sitemaps", () => {
  test("docs.phux.sh/sitemap-index.xml serves the docs index", async () => {
    let requested = "";
    const response = await handler.fetch(new Request("https://docs.phux.sh/sitemap-index.xml"), {
      ASSETS: {
        fetch: async (request) => {
          requested = new URL(request.url).pathname;
          return new Response("<sitemapindex></sitemapindex>", { headers: { "content-type": "application/xml" } });
        },
      },
    });
    expect(sitemapIndexAsset("docs.phux.sh", "/sitemap-index.xml")).toBe("/sitemap-docs-index.xml");
    expect(requested).toBe("/sitemap-docs-index.xml");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("sitemapindex");
  });

  test("/sitemap.xml redirects before assets are fetched", async () => {
    const response = await handler.fetch(new Request("https://phux.sh/sitemap.xml"), {
      ASSETS: { fetch: async () => { throw new Error("sitemap.xml must redirect"); } },
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://phux.sh/sitemap-index.xml");
  });
});

describe("markdown negotiation", () => {
  test("iOS download uses the dynamic handoff before static assets", async () => {
    const response = await handler.fetch(new Request("https://phux.sh/download/ios"), {
      ASSETS: { fetch: async () => { throw new Error("handoff must not fetch assets"); } },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/more?phone=ios&testflight=unavailable#testflight");
  });
  test("alias redirects precede assets, APIs, and app association handling", async () => {
    for (const host of ["phux.computer", "www.phux.computer"]) {
      for (const path of ["/", "/api/beta", "/_astro/site.js", "/.well-known/apple-app-site-association", "/apple-app-site-association"]) {
        const response = await handler.fetch(
          new Request(`https://${host}${path}?from=alias`, { headers: { accept: "text/markdown" } }),
          { ASSETS: { fetch: async () => { throw new Error("alias must not fetch assets"); } } },
        );
        expect(response.status).toBe(301);
        expect(response.headers.get("location")).toBe(`https://phux.sh${path}?from=alias`);
      }
    }
  });

  test("Accept: text/markdown gets a markdown response with token count", async () => {
    const request = new Request("https://phux.sh/", {
      headers: { accept: "text/markdown" },
    });
    const response = await handler.fetch(request, assetsOf(PAGE));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("vary")).toContain("Accept");
    expect(Number(response.headers.get("x-markdown-tokens"))).toBeGreaterThan(
      0,
    );
    const body = await response.text();
    expect(body).toContain("# phux");
    expect(body).toContain("you and your agents share the same terminals");
  });

  test("browser accepts keep HTML and declare Vary: Accept", async () => {
    const request = new Request("https://phux.sh/", {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    const response = await handler.fetch(request, assetsOf(PAGE));

    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("vary")).toContain("Accept");
    expect(await response.text()).toContain("<main>");
  });

  test("no accept header keeps HTML as the default", async () => {
    const response = await handler.fetch(
      new Request("https://phux.sh/"),
      assetsOf(PAGE),
    );
    expect(response.headers.get("content-type")).toBe("text/html");
  });

  test("non-HTML assets pass through untouched", async () => {
    const request = new Request("https://phux.sh/install.sh", {
      headers: { accept: "text/markdown" },
    });
    const response = await handler.fetch(
      request,
      assetsOf("#!/bin/sh\necho hi\n", "application/x-sh"),
    );
    expect(response.headers.get("content-type")).toBe("application/x-sh");
  });

  test("docs.phux.sh/build-on redirects before assets are fetched", async () => {
    const response = await handler.fetch(
      new Request("https://docs.phux.sh/build-on?from=search", {
        headers: { accept: "text/html" },
      }),
      { ASSETS: { fetch: async () => { throw new Error("build-on must not fetch assets"); } } },
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://docs.phux.sh/building?from=search",
    );
  });

  test("retired markdown URLs redirect once to the canonical twin", async () => {
    for (const [path, target] of [
      ["/quickstart/install.md", "/installation.md"],
      ["/consumers/getting-started.md", "/agents.md"],
      ["/quickstart.md", "/getting-started.md"],
      ["/build-on.md", "/building.md"],
    ]) {
      const requested: string[] = [];
      const response = await handler.fetch(new Request(`https://docs.phux.sh${path}?from=cite`), {
        ASSETS: {
          fetch: async (request) => {
            const pathname = new URL(request.url).pathname;
            requested.push(pathname);
            if (pathname === target) {
              return new Response("# Page\n", { headers: { "content-type": "text/markdown; charset=utf-8" } });
            }
            return new Response("missing", { status: 404 });
          },
        },
      });
      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(`https://docs.phux.sh${target}?from=cite`);
      expect(requested).toEqual([path, target]);
    }
  });

  test("HEAD follows the same markdown alias", async () => {
    const response = await handler.fetch(new Request("https://docs.phux.sh/quickstart/install.md", { method: "HEAD" }), {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/installation.md") {
            return new Response("# Install\n", { headers: { "content-type": "text/markdown; charset=utf-8" } });
          }
          return new Response(null, { status: 404 });
        },
      },
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://docs.phux.sh/installation.md");
  });

  test("a missing canonical twin redirects to the canonical HTML page, not the refresh stub", async () => {
    const requested: string[] = [];
    const response = await handler.fetch(new Request("https://docs.phux.sh/quickstart/install.md"), {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          requested.push(pathname);
          if (pathname === "/installation") {
            return new Response("<!doctype html><title>Install</title>", {
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }
          return new Response("missing", { status: 404 });
        },
      },
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://docs.phux.sh/installation");
    expect(requested).toEqual(["/quickstart/install.md", "/installation.md", "/installation"]);
  });

  test("a missing twin and a missing page stay a 404", async () => {
    const requested: string[] = [];
    const response = await handler.fetch(new Request("https://docs.phux.sh/quickstart/install.md"), {
      ASSETS: {
        fetch: async (request) => {
          requested.push(new URL(request.url).pathname);
          return new Response("missing", { status: 404 });
        },
      },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("missing");
    expect(requested).toEqual(["/quickstart/install.md", "/installation.md", "/installation"]);
  });

  test("when-to-use markdown is a temporary redirect", async () => {
    const response = await handler.fetch(new Request("https://docs.phux.sh/concepts/when-to-use.md"), {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/concepts.md") {
            return new Response("# Concepts\n", { headers: { "content-type": "text/markdown; charset=utf-8" } });
          }
          return new Response("missing", { status: 404 });
        },
      },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://docs.phux.sh/concepts.md");
  });

  test("a 200 non-HTML check does not redirect", async () => {
    const alias = await handler.fetch(new Request("https://docs.phux.sh/quickstart/install.md"), {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/installation.md") {
            return new Response("not markdown", { status: 200, headers: { "content-type": "text/plain" } });
          }
          return new Response("missing", { status: 404 });
        },
      },
    });
    expect(alias.status).toBe(404);
    expect(alias.headers.get("location")).toBeNull();
    expect(await alias.text()).toBe("missing");

    const page = await handler.fetch(new Request("https://docs.phux.sh/installation.md"), {
      ASSETS: {
        fetch: async (request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/installation") {
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
          }
          return new Response("missing", { status: 404 });
        },
      },
    });
    expect(page.status).toBe(404);
    expect(page.headers.get("location")).toBeNull();
  });

  test("encoded, doubled, and off-host markdown suffixes stay 404", async () => {
    for (const path of ["/quickstart/install.MD", "/quickstart/install%2Emd", "/x.md.md", "//evil.com.md"]) {
      const requested: string[] = [];
      const response = await handler.fetch(new Request(`https://docs.phux.sh${path}`), {
        ASSETS: {
          fetch: async (request) => {
            requested.push(new URL(request.url).pathname);
            return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
          },
        },
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(requested).toEqual([new URL(`https://docs.phux.sh${path}`).pathname]);
    }
  });

  test("only GET and HEAD redirect a missing markdown alias", async () => {
    const requested: string[] = [];
    const response = await handler.fetch(new Request("https://docs.phux.sh/quickstart/install.md", { method: "POST" }), {
      ASSETS: {
        fetch: async (request) => {
          requested.push(new URL(request.url).pathname);
          return new Response("missing", { status: 404 });
        },
      },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(requested).toEqual(["/quickstart/install.md"]);
  });

  test("an existing markdown twin is served", async () => {
    let calls = 0;
    const response = await handler.fetch(new Request("https://docs.phux.sh/installation.md"), {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("# Install\n", { headers: { "content-type": "text/markdown; charset=utf-8" } });
        },
      },
    });
    expect(calls).toBe(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toBe("# Install\n");
  });

  test("a markdown URL with no HTML page stays a 404", async () => {
    const requested: string[] = [];
    const response = await handler.fetch(new Request("https://docs.phux.sh/quickstart/missing.md"), {
      ASSETS: {
        fetch: async (request) => {
          requested.push(new URL(request.url).pathname);
          return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
        },
      },
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("missing");
    expect(requested).toEqual(["/quickstart/missing.md", "/quickstart/missing"]);
  });

  test("phux.sh still sends the markdown URL to the docs host", async () => {
    const response = await handler.fetch(new Request("https://phux.sh/quickstart/install.md?from=cite"), {
      ASSETS: { fetch: async () => { throw new Error("host split must happen before the markdown fallback"); } },
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://docs.phux.sh/quickstart/install.md?from=cite");
  });

  test("docs.phux.sh/quickstart redirects before assets are fetched", async () => {
    const response = await handler.fetch(
      new Request("https://docs.phux.sh/quickstart?from=search", {
        headers: { accept: "text/html" },
      }),
      { ASSETS: { fetch: async () => { throw new Error("quickstart must not fetch assets"); } } },
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://docs.phux.sh/getting-started?from=search",
    );
  });

  test("host redirects still fire before negotiation", async () => {
    const request = new Request("https://phux.sh/docs", {
      headers: { accept: "text/markdown" },
    });
    const response = await handler.fetch(request, assetsOf(PAGE));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://docs.phux.sh/docs");
  });
});

describe("telemetry ingest", () => {
  test("rejects a mismatched key", async () => {
    const response = await handler.fetch(
      new Request("https://phux.sh/api/telemetry/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telemetry-key": "nope",
        },
        body: JSON.stringify({ events: [] }),
      }),
      { ...assetsOf(PAGE), TELEMETRY_INGEST_KEY: "secret" },
    );
    expect(response.status).toBe(403);
  });

  test("rejects a missing key", async () => {
    const response = await handler.fetch(
      new Request("https://phux.sh/api/telemetry/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: [] }),
      }),
      assetsOf(PAGE),
    );
    expect(response.status).toBe(403);
  });
});

describe("tripwire traps", () => {
  test("missing, unavailable, or invalid ops policy leaves misses and assets alone", async () => {
    const pending: Promise<unknown>[] = [];
    for (const ANALYTICS of [undefined,
      { fetch: async () => new Response(null, { status: 503 }) },
      { fetch: async () => Response.json({ payload: { envBody: "must not serve" } }) },
    ]) {
      const response = await handler.fetch(new Request("https://phux.sh/fixture/settings"), {
        ASSETS: { fetch: async () => new Response("ordinary miss", { status: 404 }) },
        ANALYTICS,
      }, { waitUntil: (promise) => pending.push(promise) });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("ordinary miss");
      expect(response.headers.get("x-phux-rev")).toBeNull();
    }
    await Promise.all(pending);
  });

  test("a bait path springs the trap and reports a tripwire envelope", async () => {
    const pending: Promise<unknown>[] = [];
    const events: Array<Record<string, unknown>> = [];
    const response = await handler.fetch(
      new Request("https://phux.sh/fixture/repo/config", {
        headers: { "user-agent": "zgrab/1.0" },
      }),
      {
        ...assetsOf(PAGE),
        ANALYTICS: {
          fetch: async (request: Request) => {
            if (new URL(request.url).pathname === "/api/bait/current") return Response.json(rotationPayload());
            const batch = (await request.json()) as { events: typeof events };
            events.push(...batch.events);
            return new Response(null, { status: 204 });
          },
        },
      },
      {
        waitUntil: (promise) => {
          pending.push(promise);
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("synthetic repository response");
    await Promise.all(pending);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tripwire",
      trap: "git",
      path: "/fixture/repo/config",
      ua: "zgrab/1.0",
    });
  });

  test("legitimate pages never trip the wire", async () => {
    const response = await handler.fetch(
      new Request("https://phux.sh/", {
        headers: { accept: "text/html" },
      }),
      assetsOf(PAGE),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
  });
});

describe("hosting fast paths", () => {
  test("fingerprinted assets preserve caching and never emit visitor telemetry", async () => {
    const pending: Promise<unknown>[] = [];
    let privateCalls = 0;
    const response = await handler.fetch(
      new Request("https://docs.phux.sh/_astro/showcase.a1b2c3.js", {
        headers: { accept: "text/markdown" },
      }),
      {
        ASSETS: {
          fetch: async () =>
            new Response("export const ready = true;", {
              headers: {
                "content-type": "application/javascript",
                "cache-control": "public, max-age=31536000, immutable",
                etag: '"a1b2c3"',
              },
            }),
        },
        TELEMETRY: {
          getByName: () => {
            throw new Error("static assets must not record visitor counters");
          },
        },
        ANALYTICS: {
          fetch: async () => {
            privateCalls++;
            throw new Error("static assets must not emit private observations");
          },
        },
      },
      {
        waitUntil: (promise) => {
          pending.push(promise);
        },
      },
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("etag")).toBe('"a1b2c3"');
    expect(response.headers.get("vary")).toBeNull();
    expect(await response.text()).toBe("export const ready = true;");
    expect(pending).toEqual([]);
    expect(privateCalls).toBe(0);
  });

  test("background observation lifetime includes deferred analytics initialization", async () => {
    const pending: Promise<unknown>[] = [];
    const events: { path: string; status: number; content_type: string }[] = [];
    const response = await handler.fetch(
      new Request("https://phux.sh/?utm_source=showcase"),
      {
        ...assetsOf(PAGE),
        ANALYTICS: {
          fetch: async (request: Request) => {
            if (new URL(request.url).pathname === "/api/bait/current") return new Response(null, { status: 503 });
            const batch = (await request.json()) as { events: typeof events };
            events.push(...batch.events);
            return new Response(null, { status: 204 });
          },
        },
      },
      {
        waitUntil: (promise) => {
          pending.push(promise);
        },
      },
    );
    expect(await response.text()).toContain("<main>");
    await Promise.all(pending);
    expect(events).toMatchObject([
      { path: "/", status: 200, content_type: "text/html" },
    ]);
  });
});
