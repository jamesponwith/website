/** Response execution for policy supplied by the private ops binding. */
import { Effect } from "effect";
import {
  buildTripwireEnvelope,
  forwardEnvelope,
  runAnalytics,
  type AnalyticsEnv,
} from "./analytics";
import type { WaitUntil } from "./analytics-runtime";
import type { TrapKind } from "./tripwire-paths";
import type { SiteRotation } from "./bait-rotation";
import { readPrefix } from "./read-prefix";

export interface TrapOptions {
  /** Test seam; production uses the private policy delay. */
  delayMs?: number;
}

export async function handleTrap(
  request: Request,
  env: AnalyticsEnv,
  ctx: WaitUntil | undefined,
  trap: TrapKind,
  rotation: SiteRotation,
  options: TrapOptions = {},
): Promise<Response> {
  const delay = options.delayMs ?? rotation.depthDelayMs;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  let bodySample: string | undefined;
  if (trap === "wp-login" && request.method === "POST") {
    bodySample = await readPrefix(request.body, 1024).catch(() => undefined);
  }
  const response = trapResponse(trap, request.method, rotation);
  if (env.ANALYTICS) {
    const pending = runAnalytics(
      buildTripwireEnvelope(request, {
        trap,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        bodySample,
      }).pipe(
        Effect.flatMap((envelope) => forwardEnvelope(env, envelope)),
        Effect.ignoreCause,
      ),
    ).catch(() => {});
    if (ctx) ctx.waitUntil(pending);
    else void pending;
  }
  return response;
}

function trapResponse(trap: TrapKind, method: string, rotation: SiteRotation): Response {
  const headers = { "content-type": "text/plain; charset=utf-8", "x-phux-rev": rotation.rotationId };
  switch (trap) {
    case "env":
      return new Response(rotation.envBody, { headers });
    case "git":
      return new Response(rotation.gitBody, { headers });
    case "wp-login":
      if (method === "POST") {
        return new Response(null, { status: 302, headers: { location: rotation.wpLoginRedirect } });
      }
      return new Response(rotation.wpLoginBody, {
        headers: { ...headers, "content-type": "text/html; charset=utf-8" },
      });
    default:
      return new Response("not found", { status: 404, headers });
  }
}
