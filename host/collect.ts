/** POST /api/collect: consented browser events from the opt-in analytics card. */
import { Effect, Schema } from "effect";
import {
  attribution,
  buildEnvelope,
  canForward,
  forwardEnvelope,
  referrerHost,
  type AnalyticsEnv,
  type AnalyticsHandlerResult,
  type Envelope,
} from "./analytics";
import { BodyReadFailure, readLimitedBody } from "./analytics-runtime";
import { consentedVisitorId, visitorCookie } from "./consent";

const MAX_COLLECT_BODY_BYTES = 2 * 1024;
const CLIENT_EVENTS = new Set(["consent", "engaged", "install_copy", "outbound", "cta"]);

const CollectInput = Schema.Struct({
  event: Schema.String,
  target: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.Number),
  path: Schema.optionalKey(Schema.String),
  referrer: Schema.optionalKey(Schema.String),
  utm_source: Schema.optionalKey(Schema.String),
  utm_medium: Schema.optionalKey(Schema.String),
  utm_campaign: Schema.optionalKey(Schema.String),
});
type CollectInput = typeof CollectInput.Type;

const NO_CONTENT = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

/**
 * POST /api/collect — consented browser events (src/lib/consent.ts).
 *
 * Only `consent` itself is accepted without a prior "Allow": a "denied"
 * choice is counted anonymously and carries the old id solely so its journey
 * is erased. Every other event is silently dropped (204) unless the visitor
 * opted in and the browser sends no Global Privacy Control signal.
 */
export function handleCollect(
  request: Request,
  env: AnalyticsEnv,
): Effect.Effect<AnalyticsHandlerResult, never> {
  if (!canForward(env)) return Effect.succeed({ response: NO_CONTENT() });
  if (!sameOrigin(request)) {
    return Effect.succeed({ response: Response.json({ ok: false, error: "cross-origin" }, { status: 403 }) });
  }
  return Effect.gen(function* () {
    const input = yield* decodeCollect(request);
    const event = input.event.trim().toLowerCase();
    if (!CLIENT_EVENTS.has(event)) {
      return { response: Response.json({ ok: false, error: "unknown event" }, { status: 400 }) };
    }
    const anonId = collectIdentity(request, event, input.target);
    if (anonId === undefined) return { response: NO_CONTENT() };
    const base = yield* buildEnvelope(request, new Response(null, { status: 204 }));
    return {
      response: NO_CONTENT(),
      background: forwardEnvelope(env, clientEnvelope(base, input, event, anonId)),
    };
  }).pipe(Effect.catchTag("BodyReadFailure", (error) => Effect.succeed(collectRejection(error))));
}

function collectRejection(error: BodyReadFailure): AnalyticsHandlerResult {
  const tooLarge = error.reason === "too-large";
  return {
    response: Response.json(
      { ok: false, error: tooLarge ? "request too large" : "bad request" },
      { status: tooLarge ? 413 : 400 },
    ),
  };
}

/** Which id may ride on this event: a string, null (anonymous), or undefined (drop). */
function collectIdentity(request: Request, event: string, target: string | undefined): string | null | undefined {
  if (event !== "consent") return consentedVisitorId(request) ?? undefined;
  if (target === "granted") {
    if (request.headers.get("sec-gpc") === "1") return undefined;
    return visitorCookie(request) ?? undefined;
  }
  return visitorCookie(request);
}

function clientEnvelope(base: Envelope, input: CollectInput, event: string, anonId: string | null): Envelope {
  const landing = event === "consent";
  return {
    ...base,
    kind: "client",
    event,
    target: attribution(input.target ?? null).slice(0, 120) || undefined,
    value: clampedValue(input.value),
    path: pagePath(input.path) ?? base.path,
    content_type: "",
    status: 204,
    anon_id: anonId ?? undefined,
    ...(landing ? landingAttribution(input) : NO_ATTRIBUTION),
  };
}

// Only the consent event carries landing attribution; for later events the
// Referer header is our own page and says nothing about acquisition.
const NO_ATTRIBUTION = { referrer_host: "", utm_source: "", utm_medium: "", utm_campaign: "" };

function landingAttribution(input: CollectInput) {
  return {
    referrer_host: referrerHost(input.referrer ?? null),
    utm_source: attribution(input.utm_source ?? null),
    utm_medium: attribution(input.utm_medium ?? null),
    utm_campaign: attribution(input.utm_campaign ?? null),
  };
}

function clampedValue(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(Math.round(value), 24 * 3_600_000));
}

function pagePath(value: string | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, "").split(/[?#]/)[0]!.slice(0, 200);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function decodeCollect(request: Request): Effect.Effect<CollectInput, BodyReadFailure> {
  return Effect.gen(function* () {
    const bytes = yield* readLimitedBody(request, MAX_COLLECT_BODY_BYTES);
    const value = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      catch: () => new BodyReadFailure({ reason: "malformed" }),
    });
    return yield* Schema.decodeUnknownEffect(CollectInput)(value).pipe(
      Effect.mapError(() => new BodyReadFailure({ reason: "malformed" })),
    );
  });
}
