import { describe, expect, test } from "bun:test";
import { detectInstallPlatform, installActions, type InstallPlatform } from "../src/lib/home-platform";
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
});
