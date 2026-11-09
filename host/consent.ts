/**
 * Opt-in analytics identity on the server side (see src/lib/consent.ts).
 * A visitor's random `phux_vid` is used only with an explicit
 * `phux_consent=granted` and no Global Privacy Control signal.
 */
import { Schema } from "effect";

/** Opt-in analytics cookies, set by src/lib/consent.ts after "Allow". */
export const CONSENT_COOKIE = "phux_consent";
export const VISITOR_COOKIE = "phux_vid";

const VisitorId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/));

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** The phux_vid cookie when well-formed, whatever the consent state. */
export function visitorCookie(request: Request): string | null {
  const value = cookieValue(request, VISITOR_COOKIE);
  return value && Schema.is(VisitorId)(value) ? value : null;
}

/**
 * The visitor's opt-in id, or null. Consent must be explicit, and a browser
 * sending Global Privacy Control is treated as having declined even if an
 * older "Allow" cookie is still present.
 */
export function consentedVisitorId(request: Request): string | null {
  if (request.headers.get("sec-gpc") === "1") return null;
  if (cookieValue(request, CONSENT_COOKIE) !== "granted") return null;
  return visitorCookie(request);
}
