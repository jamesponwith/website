/**
 * Opt-in analytics for phux.sh and docs.phux.sh.
 *
 * Until a visitor clicks "Allow", nothing here stores anything on their
 * device and no client event is sent: the site keeps counting them only the
 * cookieless way (the edge Worker's daily-rotated hash). "Allow" sets two
 * first-party cookies shared by both hosts:
 *
 *   phux_consent=granted|denied   the choice itself (13 months)
 *   phux_vid=<32 hex>             a random id, only while granted (13 months)
 *
 * The Worker attaches `phux_vid` to request observations only when
 * `phux_consent=granted` and the browser does not send Global Privacy
 * Control. GPC is treated as a standing "No thanks": the card never shows.
 * Withdrawing deletes the id here and erases its history server-side.
 */

export type ConsentState = "granted" | "denied" | null;

export const CONSENT_COOKIE = "phux_consent";
export const VISITOR_COOKIE = "phux_vid";
const MAX_AGE = 395 * 24 * 60 * 60;
const ENGAGED_MIN_MS = 10_000;
const COLLECT = "/api/collect";

export function readCookie(source: string, name: string): string | null {
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function parseConsent(cookie: string): ConsentState {
  const value = readCookie(cookie, CONSENT_COOKIE);
  return value === "granted" || value === "denied" ? value : null;
}

/** `phux.sh` and its subdomains share one choice; previews stay host-only. */
export function cookieAttributes(hostname: string, protocol: string, maxAge: number): string {
  const domain = hostname === "phux.sh" || hostname.endsWith(".phux.sh") ? "; Domain=phux.sh" : "";
  const secure = protocol === "https:" ? "; Secure" : "";
  return `; Path=/; Max-Age=${maxAge}; SameSite=Lax${domain}${secure}`;
}

export function randomVisitorId(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  return Array.from(random(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Which install command was copied, or null when the text is not one. */
export function installTarget(text: string): string | null {
  const value = text.trim();
  if (/phux\.sh\/install-desktop/i.test(value)) return "desktop";
  if (/phux\.sh\/install\b.*--rune/i.test(value)) return "rune";
  if (/phux\.sh\/install/i.test(value)) return "cli";
  if (/brew\s+install\b.*\bphux\b/i.test(value)) return "brew";
  if (/cargo\s+install\b.*\bphux\b/i.test(value)) return "cargo";
  if (/(npm|pnpm|bun|yarn)\s+(i|add|install)\b.*@phux\//i.test(value)) return "npm";
  return null;
}

const OUTBOUND_HOSTS: Record<string, string> = {
  "github.com": "github",
  "discord.gg": "discord",
  "discord.com": "discord",
  "x.com": "x",
  "twitter.com": "x",
  "apps.apple.com": "app-store",
  "testflight.apple.com": "app-store",
};

function webUrl(href: string, base: string): URL | null {
  try {
    const url = new URL(href, base);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isOwnHost(host: string, here: string): boolean {
  return host === "phux.sh" || host.endsWith(".phux.sh") || host === new URL(here).hostname;
}

/** Outbound destinations worth naming; everything else is "other". */
export function outboundTarget(href: string, here: string): string | null {
  const url = webUrl(href, here);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (isOwnHost(host, here)) return null;
  return OUTBOUND_HOSTS[host] ?? "other";
}

// ── browser runtime ────────────────────────────────────────────────────────

function hasGpc(): boolean {
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function consentState(): ConsentState {
  if (hasGpc()) return "denied";
  return parseConsent(document.cookie);
}

function setCookie(name: string, value: string, maxAge = MAX_AGE): void {
  document.cookie = `${name}=${value}${cookieAttributes(location.hostname, location.protocol, maxAge)}`;
}

function send(body: Record<string, unknown>): void {
  const payload = JSON.stringify({ path: location.pathname, ...body });
  try {
    if (navigator.sendBeacon?.(COLLECT, new Blob([payload], { type: "application/json" }))) return;
  } catch {
    /* fall through to fetch */
  }
  void fetch(COLLECT, { method: "POST", body: payload, headers: { "content-type": "application/json" }, keepalive: true, credentials: "same-origin" }).catch(() => {});
}

/** Record a consented event. A no-op unless the visitor chose "Allow". */
export function track(event: string, target?: string, value?: number): void {
  if (consentState() !== "granted") return;
  send({ event, target, value });
}

function landing(): Record<string, string> {
  const params = new URLSearchParams(location.search);
  return {
    referrer: document.referrer,
    utm_source: params.get("utm_source") ?? params.get("ref") ?? "",
    utm_medium: params.get("utm_medium") ?? "",
    utm_campaign: params.get("utm_campaign") ?? "",
  };
}

export function grant(): void {
  if (!readCookie(document.cookie, VISITOR_COOKIE)) setCookie(VISITOR_COOKIE, randomVisitorId());
  setCookie(CONSENT_COOKIE, "granted");
  // The first consented event carries the landing referrer and campaign, so
  // the journey's first touch is where this visit came from.
  send({ event: "consent", target: "granted", ...landing() });
  emit();
}

export function deny(): void {
  // Sent while the id cookie still exists, so the server can erase it.
  send({ event: "consent", target: "denied" });
  setCookie(CONSENT_COOKIE, "denied");
  setCookie(VISITOR_COOKIE, "", 0);
  emit();
}

const listeners = new Set<(state: ConsentState) => void>();
export function onConsentChange(listener: (state: ConsentState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit(): void {
  const state = consentState();
  for (const listener of listeners) listener(state);
}

// ── automatic, consent-gated instrumentation ───────────────────────────────

let instrumented = false;

/** Copies of install commands, outbound clicks, `data-track` CTAs, time on page. */
export function instrument(): void {
  if (instrumented || typeof window === "undefined") return;
  instrumented = true;
  wrapClipboard();
  document.addEventListener("copy", () => trackCopy(String(getSelection() ?? ""), "selection"));
  document.addEventListener("click", onClick, { capture: true });
  trackEngagement();
}

function trackCopy(text: string, via: string): void {
  const target = installTarget(text);
  if (target) track("install_copy", `${target}:${via}`);
}

function wrapClipboard(): void {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) return;
  const original = clipboard.writeText.bind(clipboard);
  clipboard.writeText = (text: string) => {
    const result = original(text);
    void result.then(() => trackCopy(text, "button"), () => {});
    return result;
  };
}

function onClick(event: MouseEvent): void {
  const element = (event.target as Element | null)?.closest?.("a[href], [data-track]");
  if (!element) return;
  const cta = element.getAttribute("data-track");
  if (cta) return track("cta", cta.slice(0, 80));
  const href = element.getAttribute("href") ?? "";
  const target = outboundTarget(href, location.href);
  if (target) track("outbound", target);
}

function trackEngagement(): void {
  let visibleSince = document.visibilityState === "visible" ? performance.now() : 0;
  let visibleMs = 0;
  const flush = () => {
    if (visibleSince) visibleMs += performance.now() - visibleSince;
    visibleSince = 0;
    if (visibleMs >= ENGAGED_MIN_MS) track("engaged", location.pathname.slice(0, 80), Math.round(visibleMs));
    visibleMs = 0;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    else visibleSince = performance.now();
  });
  // Astro's client router swaps pages without unloading this script.
  document.addEventListener("astro:before-swap", () => {
    flush();
    visibleSince = performance.now();
  });
}
