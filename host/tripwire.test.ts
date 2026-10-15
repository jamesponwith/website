import { describe, expect, test } from "bun:test";
import { classifyTrap } from "./tripwire-paths";
import { getRotation, resetRotationCache } from "./bait-rotation";
import { handleTrap } from "./tripwire";
import { rotationPayload, syntheticRotation } from "./tripwire-fixtures";

describe("generic policy classification", () => {
  test("exact and prefix rules are case insensitive without widening exact matches", () => {
    const { rules } = syntheticRotation();
    expect(classifyTrap("/FIXTURE/SETTINGS", rules)).toBe("env");
    expect(classifyTrap("/fixture/settings-extra", rules)).toBeNull();
    expect(classifyTrap("/fixture/repo/config", rules)).toBe("git");
    expect(classifyTrap("/fixture/repository", rules)).toBeNull();
    expect(classifyTrap("/fixture/settings", [])).toBeNull();
    expect(classifyTrap("/", rules)).toBeNull();
  });
});

describe("private rotation consumption", () => {
  test("caches a complete positive payload per service binding", async () => {
    resetRotationCache();
    let calls = 0;
    const env = { ANALYTICS: { fetch: async () => {
      calls++;
      return Response.json(rotationPayload());
    } } };
    const rotation = await getRotation(env);
    expect(rotation).toEqual(syntheticRotationWithExpiry(rotation!.expiresAt));
    expect(await getRotation(env)).toEqual(rotation);
    expect(calls).toBe(1);
    expect(await getRotation({})).toBeUndefined();
    expect(await getRotation({ ANALYTICS: { fetch: async () => new Response(null, { status: 503 }) } })).toBeUndefined();
  });

  test("fails closed for malformed fields, rules, bodies, redirects, and expired rotations", async () => {
    const good = rotationPayload();
    const invalid = [
      null, [], {}, { ...good, rotationId: "" }, { ...good, depthDelayMs: -1 },
      { ...good, rotationId: "bad\nheader" },
      { ...good, depthDelayMs: 12_001 }, { ...good, expiresAt: Date.now() - 1 },
      { ...good, payload: null }, { ...good, payload: { ...good.payload, cohortFingerprint: 3 } },
      ...[undefined, [], [{ path: "relative", match: "exact", trap: "env" }],
        [{ path: "/fixture", match: "unknown", trap: "env" }],
        [{ path: "/fixture", match: "exact", trap: "unknown" }],
        [{ path: "/UPPER", match: "exact", trap: "env" }],
      ].map((rules) => ({ ...good, payload: { ...good.payload, rules } })),
      ...["envBody", "gitBody", "wpLoginBody"].flatMap((key) =>
        [undefined, 123, "", "x".repeat(65_537)].map((value) => ({ ...good, payload: { ...good.payload, [key]: value } }))),
      ...["//outside.invalid", "/bad\nheader", "https://outside.invalid", "/bad\\path"].map((wpLoginRedirect) =>
        ({ ...good, payload: { ...good.payload, wpLoginRedirect } })),
    ];
    for (const value of invalid) {
      expect(await getRotation({ ANALYTICS: { fetch: async () => Response.json(value) } })).toBeUndefined();
    }
    expect(await getRotation({ ANALYTICS: { fetch: async () => { throw new Error("offline"); } } })).toBeUndefined();
    expect(await getRotation({ ANALYTICS: { fetch: async () => new Response("invalid json") } })).toBeUndefined();
  });

  test("does not serve expired cached policy", async () => {
    const body = rotationPayload();
    body.expiresAt = Date.now() + 20;
    let calls = 0;
    const env = { ANALYTICS: { fetch: async () => {
      calls++;
      return calls === 1 ? Response.json(body) : new Response(null, { status: 503 });
    } } };
    expect(await getRotation(env)).toBeDefined();
    await Bun.sleep(30);
    expect(await getRotation(env)).toBeUndefined();
    expect(calls).toBe(2);
  });

  test("bounds stalled response-body reads as well as fetch", async () => {
    const env = { ANALYTICS: { fetch: async () => new Response(new ReadableStream()) } };
    expect(await getRotation(env)).toBeUndefined();
  }, 3000);
});

function syntheticRotationWithExpiry(expiresAt: number) {
  return { ...syntheticRotation(), expiresAt };
}

describe("policy response execution", () => {
  test("serves only provided bodies and reports without member identity or credential headers", async () => {
    const rotation = syntheticRotation();
    const events: Record<string, unknown>[] = [];
    const pending: Promise<unknown>[] = [];
    const env = { ANALYTICS: { fetch: async (request: Request) => {
      events.push(...(await request.json() as { events: typeof events }).events);
      return new Response(null, { status: 204 });
    } } };
    for (const [trap, expected] of [["env", rotation.envBody], ["git", rotation.gitBody], ["wp-login", rotation.wpLoginBody]] as const) {
      const response = await handleTrap(new Request("https://example.test/fixture/settings?sample=1", {
        headers: { cookie: "phux_mid=abcdef0123456789abcdef0123456789", authorization: "Bearer private", "x-scan": "test" },
      }), env, { waitUntil: (promise) => pending.push(promise) }, trap, rotation);
      expect(await response.text()).toBe(expected);
      expect(response.headers.get("x-phux-rev")).toBe(rotation.rotationId);
    }
    await Promise.all(pending);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ kind: "tripwire", trap: "env", query: "?sample=1", status: 200 });
    expect(events[0]!.member_id).toBeUndefined();
    const headers = JSON.parse(events[0]!.headers as string);
    expect(headers["x-scan"]).toBe("test");
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });

  test("captures capped posted credentials and redirects only to the supplied local target", async () => {
    const events: Record<string, unknown>[] = [];
    const pending: Promise<unknown>[] = [];
    const rotation = syntheticRotation();
    const response = await handleTrap(new Request("https://example.test/fixture/login", {
      method: "POST", body: "x".repeat(4096),
    }), { ANALYTICS: { fetch: async (request) => {
      events.push(...(await request.json() as { events: typeof events }).events);
      return new Response(null, { status: 204 });
    } } }, { waitUntil: (promise) => pending.push(promise) }, "wp-login", rotation);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(rotation.wpLoginRedirect);
    await Promise.all(pending);
    expect((events[0]!.body_sample as string).length).toBe(1024);
  });

  test("generic capture-only rules return ordinary misses", async () => {
    for (const trap of ["probe", "robots-bait"] as const) {
      const response = await handleTrap(new Request("https://example.test/fixture/probe"), {}, undefined, trap, syntheticRotation());
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("not found");
    }
  });
});
