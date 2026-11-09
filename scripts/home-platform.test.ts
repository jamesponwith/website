import { describe, expect, test } from "bun:test";
import { detectInstallPlatform, detectLinuxArch, installActions, type InstallPlatform } from "../src/lib/home-platform";
import { platformVisitors } from "./home-platform-fixtures";

describe("device-first homepage installs", () => {
  for (const [name, visitor] of Object.entries(platformVisitors)) {
    test(`recognizes ${name} without confusing phones with Mac/Linux`, () => {
      expect(detectInstallPlatform(visitor)).toBe(name === "ipadDesktop" ? "ipad" : name as InstallPlatform);
    });
  }
  test("does not guess Mac when browser information is unavailable", () => {
    expect(detectInstallPlatform(undefined)).toBe("unknown");
    expect(detectInstallPlatform({})).toBe("unknown");
  });
  test("only the actual Mac action downloads a Mac archive", () => {
    for (const [platform, action] of Object.entries(installActions)) {
      expect(action.href === "/download/rune").toBe(platform === "mac");
    }
  });
  test("iOS uses a native TestFlight handoff; Android retains its existing access flow", () => {
    for (const platform of ["iphone", "ipad"] as const) {
      expect(installActions[platform].target).toBeUndefined();
      expect(installActions[platform].href).toBe("/download/ios");
    }
    expect(installActions.android.target).toBe("mobile");
    expect(installActions.android.href).toBe("/more#testflight");
    expect(installActions.windows.note).toContain("WSL 2 server required");
    expect(installActions.windows.label).toBe("Install for Windows");
  });
  test("Linux leads with the Rune desktop installer and its requirements", () => {
    expect(installActions.linux.copy).toBe("curl -fsSL https://phux.sh/install | sh -s -- --rune");
    expect(installActions.linux.target).toBeUndefined();
    expect(installActions.linux.note).toContain("x86_64 or arm64 · glibc 2.39+ (Ubuntu 24.04+), Vulkan, libxkbcommon-x11");
  });
});

describe("Linux archive architecture", () => {
  const chromeLinux = platformVisitors.linux.userAgent;
  const hints = (architecture: string, bitness = "64") => ({ getHighEntropyValues: async () => ({ architecture, bitness }) });
  test("an arm64 user agent or platform picks the aarch64 tarball", async () => {
    expect(await detectLinuxArch({ userAgent: "Mozilla/5.0 (X11; Linux aarch64; rv:140.0) Gecko/20100101 Firefox/140.0" })).toBe("aarch64");
    expect(await detectLinuxArch({ userAgent: chromeLinux, platform: "Linux aarch64" })).toBe("aarch64");
  });
  test("client hints name the CPU behind Chrome's frozen x86_64 user agent", async () => {
    expect(await detectLinuxArch({ userAgent: chromeLinux, userAgentData: hints("arm") })).toBe("aarch64");
    expect(await detectLinuxArch({ userAgent: chromeLinux, userAgentData: hints("x86") })).toBe("x86_64");
  });
  test("never defaults to x86_64: no positive signal offers both", async () => {
    expect(await detectLinuxArch({ userAgent: chromeLinux, platform: "Linux x86_64" })).toBeNull();
    expect(await detectLinuxArch({ userAgent: "Mozilla/5.0 (X11; Linux armv7l)", userAgentData: hints("arm", "32") })).toBeNull();
    expect(await detectLinuxArch({ userAgent: chromeLinux, userAgentData: { getHighEntropyValues: async () => { throw new Error("denied"); } } })).toBeNull();
    expect(await detectLinuxArch(undefined)).toBeNull();
  });
});
