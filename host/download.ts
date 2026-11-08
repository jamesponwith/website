/**
 * GET /download/rune (and the retired /download/desktop) — the Apple-silicon
 * Phux Rune download.
 *
 * Redirects to the version Rune's update feed names, so the link never waits
 * on a site rebuild. Like Rune itself, only the version is read from the feed;
 * asset URLs are derived from it. Prefer the DMG only after a successful HEAD;
 * releases before 0.1.0 ship only the ZIP. Feed failures keep the last good
 * download, or fall back to the releases page.
 */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const RELEASES = "https://github.com/no-phux/phux/releases";
const FEED = `${RELEASES}/download/channels/rune.json`;
const FRESH_MS = 5 * 60_000;
const VERSION = /^\d+\.\d+\.\d+(-alpha\.\d+)?$/;

let cached: { url: string; at: number } | null = null;

export function runeArchiveUrl(version: string, format: "zip" | "dmg" = "zip"): string {
  return `${RELEASES}/download/rune-v${version}/phux-rune-${version}-macos-arm64.${format}`;
}

export async function runeDownload(
  fetchImpl: Fetch = (input, init) => fetch(input, init),
  now = Date.now(),
): Promise<Response> {
  const url = await runeUrl(fetchImpl, now);
  return new Response(null, {
    status: 302,
    headers: {
      location: url ?? RELEASES,
      "cache-control": "no-store",
    },
  });
}

async function runeUrl(fetchImpl: Fetch, now: number): Promise<string | null> {
  if (cached && now - cached.at < FRESH_MS) return cached.url;
  try {
    // One deadline covers both feed and asset lookup, including the JSON body.
    const signal = AbortSignal.timeout(5_000);
    const version = await feedVersion(fetchImpl, signal);
    if (!version) return cached?.url ?? null;
    const url = await preferredArchive(version, fetchImpl, signal);
    cached = { url, at: now };
    return url;
  } catch {
    return cached?.url ?? null;
  }
}

async function feedVersion(fetchImpl: Fetch, signal: AbortSignal): Promise<string | null> {
  const response = await fetchImpl(FEED, { signal });
  if (!response.ok) return null;
  const feed = (await response.json()) as { version?: unknown } | null;
  const version = feed?.version;
  return typeof version === "string" && version.length <= 64 && VERSION.test(version) ? version : null;
}

async function preferredArchive(version: string, fetchImpl: Fetch, signal: AbortSignal): Promise<string> {
  const zip = runeArchiveUrl(version);
  const dmg = runeArchiveUrl(version, "dmg");
  try {
    const response = await fetchImpl(dmg, { method: "HEAD", signal });
    if (response.ok) return dmg;
    if (response.status === 404) return zip;
  } catch {
    // A timeout or transient HTTP failure must not discard a confirmed DMG.
  }
  return cached?.url === dmg ? dmg : zip;
}

/** Tests only: forget the remembered download. */
export function resetRuneDownload(): void {
  cached = null;
}
