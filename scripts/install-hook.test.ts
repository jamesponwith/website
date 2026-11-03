import { expect, test } from "bun:test";
import { advanceMoment } from "../src/components/prototype/vgpu/live/install-hook";
import { detectPhone, requestedNote } from "../src/lib/beta";
import { cliInstall, desktopFirstOpen, desktopInstall, dryRun, installTargets, runeInstall } from "../src/lib/install";

test("the dry run is the same installer told to install nothing",()=>{
  expect(dryRun(cliInstall)).toBe("curl -fsSL https://phux.sh/install | sh -s -- --dry-run");
  expect(dryRun(desktopInstall)).toBe("curl -fsSL https://phux.sh/install-desktop | sh -s -- --dry-run");
  expect(dryRun(runeInstall)).toBe("curl -fsSL https://phux.sh/install | sh -s -- --rune --dry-run");
  expect(dryRun("")).toBe("");
  expect(installTargets.map(t=>t.id)).toEqual(["cli","rune","mobile"]);
  expect(installTargets.find(t=>t.id==="rune")?.command).toBe("curl -fsSL https://phux.sh/install | sh -s -- --rune");
  expect(installTargets.find(t=>t.id==="rune")?.note).toBe("Alpha · Apple-silicon Mac (macOS 14+) · or install from a terminal on macOS or x86_64 Linux. Installs the phux CLI too if none is found.");
  expect(desktopFirstOpen).toBe("First open: macOS asks to confirm an app downloaded from the internet. Choose Open.");
});
test("the visitor's phone is detected, and a computer has none",()=>{
  expect(detectPhone({userAgent:"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36"})).toBe("android");
  expect(detectPhone({userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"})).toBe("ios");
  expect(detectPhone({userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15",maxTouchPoints:5})).toBe("ios");
  expect(detectPhone({userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15",maxTouchPoints:0})).toBeNull();
  expect(detectPhone({userAgent:"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141 Safari/537.36"})).toBeNull();
  expect(detectPhone(undefined)).toBeNull();
});
test("the request note names who sends the invite",()=>{
  expect(requestedNote("ios","invited","a@b.co")).toBe("Invite sent. Check a@b.co for an email from TestFlight.");
  expect(requestedNote("ios","requested","a@b.co")).toBe("Request received. The TestFlight invite will go to a@b.co.");
  expect(requestedNote("android","requested","a@b.co")).toMatch(/Google Play/);
});
test("attention moments only advance",()=>{
  expect(advanceMoment("idle","engaged")).toBe("engaged");
  expect(advanceMoment("drove","engaged")).toBe("drove");
  expect(advanceMoment("copied","drove")).toBe("copied");
});
