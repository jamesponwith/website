import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { resetRuneDownload, runeArchiveUrl, runeDownload, runeLinuxArchiveUrl, runeLinuxDownload, type Fetch } from "./download";
import handler from "./index";

const RELEASES = "https://github.com/no-phux/phux/releases";
const FEED = `${RELEASES}/download/channels/rune.json`;
const ZIP = `${RELEASES}/download/rune-v0.1.0/phux-rune-0.1.0-macos-arm64.zip`;
const DMG = `${RELEASES}/download/rune-v0.1.0/phux-rune-0.1.0-macos-arm64.dmg`;
const FRESH_MS = 5 * 60_000;

const feed = (version: unknown) => Response.json({ schema: 1, version, targets: {} });
const status = (code: number): Fetch => async () => new Response(null, { status: code });
const offline: Fetch = async () => { throw new Error("offline"); };
const release = (version: unknown, probe: Fetch = status(404)) =>
  mock<Fetch>(async (url, init) => url === FEED ? feed(version) : probe(url, init));
const location = async (fetchImpl: Fetch, now = 0) =>
  (await runeDownload(fetchImpl, now)).headers.get("location");

describe("GET /download/rune", () => {
  beforeEach(resetRuneDownload);
  afterEach(() => mock.restore());

  test("prefers the DMG after a successful HEAD", async () => {
    const fetchImpl = release("0.1.0", status(200));
    const response = await runeDownload(fetchImpl, 0);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DMG);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([FEED, DMG]);
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe("HEAD");
    expect(runeArchiveUrl("0.1.0", "dmg")).toBe(DMG);
  });

  test("keeps the ZIP for releases without a DMG, alphas included", async () => {
    expect(await location(release("0.1.0"))).toBe(ZIP);
    resetRuneDownload();
    expect(await location(release("0.1.0-alpha.23"))).toBe(
      `${RELEASES}/download/rune-v0.1.0-alpha.23/phux-rune-0.1.0-alpha.23-macos-arm64.zip`,
    );
  });

  test.each(["/download/rune", "/download/desktop"])("the host endpoint %s serves it", async (path) => {
    spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(feed("0.1.0"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const asset = mock(async () => new Response("not the download", { status: 404 }));
    const response = await handler.fetch(new Request(`https://phux.sh${path}`), { ASSETS: { fetch: asset } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DMG);
    expect(asset).not.toHaveBeenCalled();
  });

  test.each([403, 405, 429, 500, 503])("falls back to ZIP when the DMG probe returns %i", async (code) => {
    expect(await location(release("0.1.0", status(code)))).toBe(ZIP);
  });

  test("falls back to ZIP when the DMG probe throws", async () => {
    expect(await location(release("0.1.0", offline))).toBe(ZIP);
  });

  test.each([200, 404, 503])("caches the resolved download for exactly five minutes (%i)", async (code) => {
    const fetchImpl = release("0.1.0", status(code));
    const expected = code === 200 ? DMG : ZIP;
    expect(await location(fetchImpl)).toBe(expected);
    expect(await location(fetchImpl, FRESH_MS - 1)).toBe(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await location(fetchImpl, FRESH_MS)).toBe(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test("rechecks a missing DMG when the cache expires", async () => {
    expect(await location(release("0.1.0"))).toBe(ZIP);
    expect(await location(release("0.1.0", status(200)), FRESH_MS)).toBe(DMG);
  });

  test.each([status(503), status(429), offline])("retains a confirmed DMG on a transient probe failure", async (probe) => {
    await location(release("0.1.0", status(200)));
    expect(await location(release("0.1.0", probe), FRESH_MS)).toBe(DMG);
  });

  test("never reuses the old DMG when a newer version's probe fails", async () => {
    await location(release("0.1.0", status(200)));
    expect(await location(release("0.1.1", offline), FRESH_MS)).toBe(
      `${RELEASES}/download/rune-v0.1.1/phux-rune-0.1.1-macos-arm64.zip`,
    );
  });

  test.each([
    undefined, null, 7, {}, "", "0.1", "v0.1.0", "0.1.0-beta.1", "0.1.0+build", "../evil",
    "0.1.0/../../evil", "0.1.0?x=https://evil.test", "0.1.0\n", "0.1.0\r\nLocation:evil", " 0.1.0",
    `${"1".repeat(65)}.0.0`,
  ])("rejects feed version %j before probing assets", async (version) => {
    const fetchImpl = release(version, status(200));
    expect(await location(fetchImpl)).toBe(RELEASES);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([FEED]);
  });

  const badFeeds: Fetch[] = [status(504), offline, async () => new Response("not JSON"), async () => Response.json(null)];

  test.each(badFeeds)("falls back to the releases page on a bad feed without a cache", async (fetchImpl) => {
    expect(await location(fetchImpl)).toBe(RELEASES);
  });

  test("retains the last good download on bad feeds", async () => {
    await location(release("0.1.0", status(200)));
    for (const fetchImpl of badFeeds) expect(await location(fetchImpl, FRESH_MS)).toBe(DMG);
  });

  test("shares one five-second deadline across the feed and HEAD request", async () => {
    const timeout = spyOn(AbortSignal, "timeout");
    const fetchImpl = release("0.1.0", status(200));
    await location(fetchImpl);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(fetchImpl.mock.calls[1]![1]?.signal).toBe(fetchImpl.mock.calls[0]![1]?.signal);
  });
});

describe("GET /download/rune/linux-*", () => {
  beforeEach(resetRuneDownload);
  afterEach(() => mock.restore());
  const tarball = (version: string, arch: string) =>
    `${RELEASES}/download/rune-v${version}/phux-rune-${version}-linux-${arch}.tar.gz`;
  const linux = async (arch: "x86_64" | "aarch64", fetchImpl: Fetch, now = 0) =>
    (await runeLinuxDownload(arch, fetchImpl, now)).headers.get("location");

  test.each(["x86_64", "aarch64"] as const)("redirects to the feed's %s tarball without probing it", async (arch) => {
    const fetchImpl = release("0.1.5");
    const response = await runeLinuxDownload(arch, fetchImpl, 0);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(tarball("0.1.5", arch));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([FEED]);
    expect(runeLinuxArchiveUrl("0.1.5", arch)).toBe(tarball("0.1.5", arch));
  });

  test("caches the feed version for five minutes and keeps it on a bad feed", async () => {
    const fetchImpl = release("0.1.5");
    await linux("aarch64", fetchImpl);
    expect(await linux("x86_64", fetchImpl, FRESH_MS - 1)).toBe(tarball("0.1.5", "x86_64"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const bad of [status(504), offline]) expect(await linux("aarch64", bad, FRESH_MS)).toBe(tarball("0.1.5", "aarch64"));
  });

  test.each([status(504), offline, async () => Response.json({ version: "../evil" })] as Fetch[])(
    "falls back to the releases page on a bad feed without a cache",
    async (fetchImpl) => {
      expect(await linux("aarch64", fetchImpl)).toBe(RELEASES);
    },
  );

  test.each(["x86_64", "aarch64"])("the host endpoint /download/rune/linux-%s serves it", async (arch) => {
    spyOn(globalThis, "fetch").mockResolvedValueOnce(feed("0.1.5"));
    const asset = mock(async () => new Response("not the download", { status: 404 }));
    const response = await handler.fetch(new Request(`https://phux.sh/download/rune/linux-${arch}`), { ASSETS: { fetch: asset } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(tarball("0.1.5", arch));
    expect(asset).not.toHaveBeenCalled();
  });

  test("an unknown architecture is not a download", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const asset = mock(async () => new Response("missing", { status: 404 }));
    const response = await handler.fetch(new Request("https://phux.sh/download/rune/linux-riscv64"), { ASSETS: { fetch: asset } });
    expect(response.headers.get("location")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
