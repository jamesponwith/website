import { describe, expect, test } from "bun:test";
import { cookieAttributes, installTarget, outboundTarget, parseConsent, randomVisitorId } from "./consent";
import { cliInstall, desktopInstall, runeInstall } from "./install";

describe("consent helpers", () => {
  test("parses only explicit choices", () => {
    expect(parseConsent("a=1; phux_consent=granted")).toBe("granted");
    expect(parseConsent("phux_consent=denied")).toBe("denied");
    expect(parseConsent("phux_consent=yes")).toBeNull();
    expect(parseConsent("")).toBeNull();
  });
  test("cookies are shared across phux.sh hosts and host-only elsewhere", () => {
    expect(cookieAttributes("docs.phux.sh", "https:", 10)).toBe("; Path=/; Max-Age=10; SameSite=Lax; Domain=phux.sh; Secure");
    expect(cookieAttributes("localhost", "http:", 10)).toBe("; Path=/; Max-Age=10; SameSite=Lax");
    expect(cookieAttributes("evilphux.sh", "https:", 10)).not.toContain("Domain");
  });
  test("visitor ids are 32 hex characters", () => {
    expect(randomVisitorId()).toMatch(/^[a-f0-9]{32}$/);
    expect(randomVisitorId((b) => b.fill(255))).toBe("f".repeat(32));
  });
  test("recognizes the site's install commands", () => {
    expect(installTarget(cliInstall)).toBe("cli");
    expect(installTarget(runeInstall)).toBe("rune");
    expect(installTarget(desktopInstall)).toBe("desktop");
    expect(installTarget("brew install no-phux/tap/phux")).toBe("brew");
    expect(installTarget("bun add @phux/pi")).toBe("npm");
    expect(installTarget("phux attach")).toBeNull();
  });
  test("names outbound destinations and ignores our own hosts", () => {
    const here = "https://phux.sh/";
    expect(outboundTarget("https://github.com/no-phux/phux", here)).toBe("github");
    expect(outboundTarget("https://discord.gg/abc", here)).toBe("discord");
    expect(outboundTarget("https://docs.phux.sh/overview", here)).toBeNull();
    expect(outboundTarget("/privacy", here)).toBeNull();
    expect(outboundTarget("mailto:privacy@phall.io", here)).toBeNull();
    expect(outboundTarget("https://example.com", here)).toBe("other");
  });
});
