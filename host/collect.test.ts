import { describe, expect, test } from "bun:test";

import { buildEnvelope, consentedVisitorId, runAnalytics, type Envelope } from "./analytics";
import { handleAnalyticsHttp } from "./analytics-http";

const VID = "0123456789abcdef0123456789abcdef";

function harness() {
  const sent: Envelope[] = [];
  const pending: Promise<unknown>[] = [];
  const env = {
    ASSETS: { fetch: async () => new Response("x") },
    ANALYTICS: {
      fetch: async (request: Request) => {
        const body = (await request.json()) as { events: Envelope[] };
        sent.push(...body.events);
        return new Response(null, { status: 204 });
      },
    },
  };
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
  const collect = async (body: unknown, headers: Record<string, string> = {}, host = "https://phux.sh") => {
    const response = await handleAnalyticsHttp(new Request(`${host}/api/collect`, {
      method: "POST",
      headers: { origin: host, "content-type": "application/json", "user-agent": "Mozilla/5.0", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }), env, ctx);
    await Promise.all(pending);
    return response;
  };
  return { sent, collect };
}

const granted = { cookie: `phux_consent=granted; phux_vid=${VID}` };

describe("consented visitor id", () => {
  const request = (cookie: string, gpc = false) =>
    new Request("https://phux.sh/", { headers: { cookie, ...(gpc ? { "sec-gpc": "1" } : {}) } });
  test("requires an explicit grant, a well-formed id, and no GPC", () => {
    expect(consentedVisitorId(request(granted.cookie))).toBe(VID);
    expect(consentedVisitorId(request(`phux_vid=${VID}`))).toBeNull();
    expect(consentedVisitorId(request(`phux_consent=denied; phux_vid=${VID}`))).toBeNull();
    expect(consentedVisitorId(request("phux_consent=granted; phux_vid=../../x"))).toBeNull();
    expect(consentedVisitorId(request(granted.cookie, true))).toBeNull();
  });
  test("ordinary request envelopes carry the id only with consent", async () => {
    const envelope = (cookie: string) => runAnalytics(buildEnvelope(
      new Request("https://phux.sh/?ref=hn", { headers: { cookie } }), new Response("ok"),
    ));
    expect((await envelope(granted.cookie)).anon_id).toBe(VID);
    expect((await envelope("")).anon_id).toBeUndefined();
    expect((await envelope("")).utm_source).toBe("hn");
  });
});

describe("POST /api/collect", () => {
  test("a grant carries the id and the landing attribution", async () => {
    const { sent, collect } = harness();
    const response = await collect(
      { event: "consent", target: "granted", path: "/docs?secret=1", referrer: "https://news.ycombinator.com/item?id=1", utm_source: "hn", utm_campaign: "launch" },
      granted,
    );
    expect(response.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "client", event: "consent", target: "granted", anon_id: VID, path: "/docs",
      referrer_host: "news.ycombinator.com", utm_source: "hn", utm_campaign: "launch",
    });
  });

  test("events without consent are dropped silently", async () => {
    const { sent, collect } = harness();
    expect((await collect({ event: "install_copy", target: "cli:button" })).status).toBe(204);
    expect((await collect({ event: "install_copy" }, { cookie: `phux_consent=denied; phux_vid=${VID}` })).status).toBe(204);
    expect((await collect({ event: "engaged", value: 20_000 }, { ...granted, "sec-gpc": "1" })).status).toBe(204);
    expect(sent).toHaveLength(0);
  });

  test("consented events never carry acquisition fields", async () => {
    const { sent, collect } = harness();
    await collect({ event: "install_copy", target: "cli:button", referrer: "https://evil.example", utm_source: "spoof" }, { ...granted, referer: "https://phux.sh/" });
    expect(sent[0]).toMatchObject({ event: "install_copy", anon_id: VID, referrer_host: "", utm_source: "" });
  });

  test("a denial is counted and carries the id being withdrawn", async () => {
    const { sent, collect } = harness();
    await collect({ event: "consent", target: "denied" }, granted);
    await collect({ event: "consent", target: "denied" });
    expect(sent.map((e) => [e.target, e.anon_id])).toEqual([["denied", VID], ["denied", undefined]]);
  });

  test("GPC blocks a grant", async () => {
    const { sent, collect } = harness();
    await collect({ event: "consent", target: "granted" }, { ...granted, "sec-gpc": "1" });
    expect(sent).toHaveLength(0);
  });

  test("rejects cross-origin posts, unknown events, oversized and malformed bodies", async () => {
    const { sent, collect } = harness();
    expect((await collect({ event: "consent", target: "granted" }, { ...granted, origin: "https://evil.example" })).status).toBe(403);
    expect((await collect({ event: "purchase" }, granted)).status).toBe(400);
    expect((await collect("not json", granted)).status).toBe(400);
    expect((await collect({ event: "cta", target: "x".repeat(4000) }, granted)).status).toBe(413);
    expect((await handleAnalyticsHttp(new Request("https://phux.sh/api/collect"), { ASSETS: { fetch: async () => new Response() } })).status).toBe(405);
    expect(sent).toHaveLength(0);
  });

  test("value is clamped and the path is reduced to a same-site pathname", async () => {
    const { sent, collect } = harness();
    await collect({ event: "engaged", value: 1e12, path: "//evil.example/x" }, granted);
    expect(sent[0]?.value).toBe(24 * 3_600_000);
    expect(sent[0]?.path).toBe("/api/collect");
  });
});

