import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { desktopArchiveUrl, desktopDownload, resetDesktopDownload, runeDownload, type Fetch } from "./download";
import handler from "./index";

const RELEASES = "https://github.com/no-phux/phux/releases";
const MANIFEST = `${RELEASES}/download/channels/stable.json`;
const ZIP = `${RELEASES}/download/desktop-v0.40.0/phux-desktop-0.40.0-macos-arm64.zip`;
const DMG = `${RELEASES}/download/desktop-v0.40.0/phux-desktop-0.40.0-macos-arm64.dmg`;
const FRESH_MS = 5 * 60_000;

const manifest = (version: unknown, channel = "stable") =>
  Response.json({ schema_version: 1, channel, products: { desktop: { version, artifacts: {} } } });
const status = (code: number): Fetch => async () => new Response(null, { status: code });
const offline: Fetch = async () => { throw new Error("offline"); };
const release = (version: unknown, probe: Fetch = status(404)) =>
  mock<Fetch>(async (url, init) => url === MANIFEST ? manifest(version) : probe(url, init));
const location = async (fetchImpl: Fetch, now = 0) =>
  (await desktopDownload(fetchImpl, now)).headers.get("location");

describe("GET /download/desktop", () => {
  beforeEach(resetDesktopDownload);
  afterEach(() => mock.restore());

  test("keeps the ZIP download for existing releases without a DMG", async () => {
    const fetchImpl = release("0.40.0");
    const response = await desktopDownload(fetchImpl, 0);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(ZIP);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([MANIFEST, DMG]);
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe("HEAD");
    expect(desktopArchiveUrl("0.40.0")).toBe(ZIP);
  });

  test.each([200, 204])("prefers the DMG after a successful HEAD (%i)", async (code) => {
    const fetchImpl = release("0.40.0", status(code));
    expect(await location(fetchImpl)).toBe(DMG);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([MANIFEST, DMG]);
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe("HEAD");
  });

  test("the existing host endpoint serves the resolved download without changing consumers", async () => {
    spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(manifest("0.40.0"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const asset = mock(async () => new Response("not the download", { status: 404 }));
    const response = await handler.fetch(new Request("https://phux.sh/download/desktop"), {
      ASSETS: { fetch: asset },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DMG);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(asset).not.toHaveBeenCalled();
  });

  test.each([403, 405, 429, 500, 503])("falls back to ZIP when the DMG probe returns %i", async (code) => {
    expect(await location(release("0.40.0", status(code)))).toBe(ZIP);
  });

  test("falls back to ZIP when the DMG probe throws", async () => {
    expect(await location(release("0.40.0", offline))).toBe(ZIP);
  });

  test.each([200, 404, 503])("caches the resolved download for exactly five minutes (%i)", async (code) => {
    const fetchImpl = release("0.40.0", status(code));
    const expected = code === 200 ? DMG : ZIP;
    expect(await location(fetchImpl)).toBe(expected);
    expect(await location(fetchImpl, FRESH_MS - 1)).toBe(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await location(fetchImpl, FRESH_MS)).toBe(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test("rechecks a missing DMG when the cache expires, even for the same version", async () => {
    expect(await location(release("0.40.0"))).toBe(ZIP);
    const available = release("0.40.0", status(200));
    expect(await location(available, FRESH_MS - 1)).toBe(ZIP);
    expect(available).not.toHaveBeenCalled();
    expect(await location(available, FRESH_MS)).toBe(DMG);
  });

  test("refreshes the manifest version and probes its own DMG, not the old version", async () => {
    await location(release("0.40.0", status(200)));
    const newer = release("0.41.0", status(200));
    expect(await location(newer, FRESH_MS)).toBe(
      `${RELEASES}/download/desktop-v0.41.0/phux-desktop-0.41.0-macos-arm64.dmg`,
    );
    expect(newer.mock.calls[1]![0]).toBe(
      `${RELEASES}/download/desktop-v0.41.0/phux-desktop-0.41.0-macos-arm64.dmg`,
    );
  });

  test.each([status(503), status(429), offline])("retains a confirmed DMG on a transient probe failure", async (probe) => {
    await location(release("0.40.0", status(200)));
    expect(await location(release("0.40.0", probe), FRESH_MS)).toBe(DMG);
  });

  test("uses ZIP if a previously confirmed DMG is now missing", async () => {
    await location(release("0.40.0", status(200)));
    expect(await location(release("0.40.0"), FRESH_MS)).toBe(ZIP);
  });

  test("never reuses the old DMG when a newer version's probe fails", async () => {
    await location(release("0.40.0", status(200)));
    expect(await location(release("0.41.0", offline), FRESH_MS)).toBe(
      `${RELEASES}/download/desktop-v0.41.0/phux-desktop-0.41.0-macos-arm64.zip`,
    );
  });

  const badManifests: Fetch[] = [
    status(503),
    offline,
    async () => new Response("not JSON"),
    async () => Response.json(null),
    async () => Response.json({}),
    async () => Response.json({ channel: "stable", products: null }),
    async () => manifest("0.40.0", "next"),
    async () => manifest("0.40"),
  ];

  test.each(badManifests)("falls back to the releases page on a bad manifest without a cache", async (fetchImpl) => {
    expect(await location(fetchImpl)).toBe(RELEASES);
  });

  test.each([200, 404])("retains the last good download on bad manifests (%i)", async (code) => {
    await location(release("0.40.0", status(code)));
    for (const fetchImpl of badManifests) {
      expect(await location(fetchImpl, FRESH_MS)).toBe(code === 200 ? DMG : ZIP);
    }
  });

  test("does not renew the cache after manifest failure, allowing the next click to recover", async () => {
    await location(release("0.40.0"));
    expect(await location(offline, FRESH_MS)).toBe(ZIP);
    const recovered = release("0.40.0", status(200));
    expect(await location(recovered, FRESH_MS + 1)).toBe(DMG);
    expect(recovered).toHaveBeenCalledTimes(2);
  });

  test.each([
    undefined, null, 40, {}, [], "", "0.40", "v0.40.0", "0.40.0-beta.1", "0.40.0+build",
    "../../evil", "0.40.0/../../evil", "0.40.0?redirect=https://evil.test", "0.40.0#evil",
    "https://evil.test/0.40.0", "0.40.0%0d%0aLocation:evil", "0.40.0\r\nLocation:evil",
    "0.40.0\n", "0.40.0\r", "0.40.0\u2028", "0.40.0\u2029", " 0.40.0", "0.40.0 ",
    "0.40.0\0", "０.４０.０", `${"1".repeat(65)}.0.0`,
  ])("rejects an invalid or malicious manifest version (%j) before probing assets", async (version) => {
    const fetchImpl = release(version, status(200));
    expect(await location(fetchImpl)).toBe(RELEASES);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([MANIFEST]);
  });

  test("ignores manifest-supplied URLs and derives only trusted asset paths", async () => {
    const fetchImpl = mock<Fetch>(async (url) => {
      if (url !== MANIFEST) return new Response(null, { status: 200 });
      return Response.json({
        channel: "stable",
        products: { desktop: { version: "0.40.0", artifacts: { dmg: { url: "https://evil.test/a.dmg" } } } },
      });
    });
    expect(await location(fetchImpl)).toBe(DMG);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([MANIFEST, DMG]);
  });

  test("shares one five-second deadline across the manifest and HEAD request", async () => {
    const timeout = spyOn(AbortSignal, "timeout");
    const fetchImpl = release("0.40.0", status(200));
    await location(fetchImpl);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(5_000);
    const signal = fetchImpl.mock.calls[0]![1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(fetchImpl.mock.calls[1]![1]?.signal).toBe(signal);
  });

  test("a manifest deadline falls back without probing the DMG", async () => {
    const controller = new AbortController();
    spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = mock<Fetch>(async (_url, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      });
    });
    const pending = location(fetchImpl);
    controller.abort(new DOMException("timed out", "TimeoutError"));
    expect(await pending).toBe(RELEASES);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a DMG deadline falls back to ZIP", async () => {
    const controller = new AbortController();
    spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = release("0.40.0", async (_url, init) => {
      controller.abort(new DOMException("timed out", "TimeoutError"));
      init!.signal!.throwIfAborted();
      throw new Error("unreachable");
    });
    expect(await location(fetchImpl)).toBe(ZIP);
  });
});

describe("GET /download/rune", () => {
  const FEED = `${RELEASES}/download/channels/rune.json`;
  const RUNE = `${RELEASES}/download/rune-v0.1.0-alpha.8/phux-rune-0.1.0-alpha.8-macos-arm64.zip`;
  const feed = (version: unknown): Fetch => async () => Response.json({ schema: 1, version });
  const rune = async (fetchImpl: Fetch, now = 0) =>
    (await runeDownload(fetchImpl, now)).headers.get("location");

  beforeEach(resetDesktopDownload);
  afterEach(() => mock.restore());

  test("redirects to the feed's macOS archive", async () => {
    const fetchImpl = mock<Fetch>(feed("0.1.0-alpha.8"));
    const response = await runeDownload(fetchImpl, 0);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(RUNE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchImpl.mock.calls[0]![0]).toBe(FEED);
  });

  test("a final version has no suffix", async () => {
    expect(await rune(feed("0.1.0"))).toBe(`${RELEASES}/download/rune-v0.1.0/phux-rune-0.1.0-macos-arm64.zip`);
  });

  test.each([["1.0"], ["0.1.0-beta.1"], ["../evil"], [7], [null]])("rejects version %p", async (version) => {
    expect(await rune(feed(version))).toBe(RELEASES);
  });

  test("keeps the last good download when the feed fails", async () => {
    await rune(feed("0.1.0-alpha.8"));
    expect(await rune(offline, FRESH_MS + 1)).toBe(RUNE);
    expect(await rune(status(503), FRESH_MS + 2)).toBe(RUNE);
  });

  test("falls back to the releases page with nothing remembered", async () => {
    expect(await rune(offline)).toBe(RELEASES);
  });

  test("the host endpoint serves it", async () => {
    spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ version: "0.1.0-alpha.8" }));
    const asset = mock(async () => new Response("not the download", { status: 404 }));
    const response = await handler.fetch(new Request("https://phux.sh/download/rune"), {
      ASSETS: { fetch: asset },
    });
    expect(response.headers.get("location")).toBe(RUNE);
    expect(asset).not.toHaveBeenCalled();
  });
});
