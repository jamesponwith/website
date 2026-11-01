/**
 * GET /download/desktop — the stable Apple-silicon Phux Desktop download.
 *
 * Redirects to the version phux's stable channel manifest names, so the link
 * never waits on a site rebuild. Like phux's own clients, only the version is
 * read from the manifest; asset URLs are derived from it. Prefer the DMG only
 * after a successful HEAD; older releases retain their ZIP download. Manifest
 * failures keep the last good download, or fall back to the releases page.
 */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const RELEASES = "https://github.com/no-phux/phux/releases";
const MANIFEST = `${RELEASES}/download/channels/stable.json`;
const FRESH_MS = 5 * 60_000;

const RUNE_FEED = `${RELEASES}/download/channels/rune.json`;
const RUNE_VERSION = /^\d+\.\d+\.\d+(-alpha\.\d+)?$/;

let cached: { url: string; at: number } | null = null;
let cachedRune: { url: string; at: number } | null = null;

export function desktopArchiveUrl(version: string, format: "zip" | "dmg" = "zip"): string {
  return `${RELEASES}/download/desktop-v${version}/phux-desktop-${version}-macos-arm64.${format}`;
}

export async function desktopDownload(
  fetchImpl: Fetch = (input, init) => fetch(input, init),
  now = Date.now(),
): Promise<Response> {
  const url = await stableDesktopUrl(fetchImpl, now);
  return new Response(null, {
    status: 302,
    headers: {
      location: url ?? RELEASES,
      "cache-control": "no-store",
    },
  });
}

async function stableDesktopUrl(fetchImpl: Fetch, now: number): Promise<string | null> {
  if (cached && now - cached.at < FRESH_MS) return cached.url;
  try {
    // One deadline covers both manifest and asset lookup, including the JSON body.
    const signal = AbortSignal.timeout(5_000);
    const version = await stableDesktopVersion(fetchImpl, signal);
    if (!version) return cached?.url ?? null;
    const url = await preferredDesktopArchive(version, fetchImpl, signal);
    cached = { url, at: now };
    return url;
  } catch {
    return cached?.url ?? null;
  }
}

async function stableDesktopVersion(fetchImpl: Fetch, signal: AbortSignal): Promise<string | null> {
  const response = await fetchImpl(MANIFEST, { signal });
  if (!response.ok) return null;
  const manifest = (await response.json()) as { channel?: unknown; products?: { desktop?: { version?: unknown } } };
  const version = manifest.products?.desktop?.version;
  if (
    manifest.channel !== "stable" || typeof version !== "string" || version.length > 64 ||
    version.trim() !== version || !/^\d+\.\d+\.\d+$/.test(version)
  ) return null;
  return version;
}

async function preferredDesktopArchive(version: string, fetchImpl: Fetch, signal: AbortSignal): Promise<string> {
  const zip = desktopArchiveUrl(version);
  const dmg = desktopArchiveUrl(version, "dmg");
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
export function resetDesktopDownload(): void {
  cached = null;
  cachedRune = null;
}

/**
 * GET /download/rune — the Apple-silicon Phux Rune archive. Rune has its own
 * feed and ships ZIPs only, and its versions may carry an alpha suffix.
 */
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
  if (cachedRune && now - cachedRune.at < FRESH_MS) return cachedRune.url;
  try {
    const response = await fetchImpl(RUNE_FEED, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return cachedRune?.url ?? null;
    const { version } = (await response.json()) as { version?: unknown };
    if (typeof version !== "string" || !RUNE_VERSION.test(version)) return cachedRune?.url ?? null;
    const url = `${RELEASES}/download/rune-v${version}/phux-rune-${version}-macos-arm64.zip`;
    cachedRune = { url, at: now };
    return url;
  } catch {
    return cachedRune?.url ?? null;
  }
}
