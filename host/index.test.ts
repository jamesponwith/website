import { describe, expect, test } from "bun:test";
import handler from "./index";
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

describe("markdown negotiation", () => {
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
