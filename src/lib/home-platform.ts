import { detectPhone, type Phone } from "./beta";
import { iosDownload, runeDownload } from "./install";
import { docsHref } from "./site";

export type InstallPlatform = "iphone" | "ipad" | "android" | "mac" | "linux" | "windows" | "unknown";
type Visitor = Parameters<typeof detectPhone>[0];
type InstallAction = { label: string; href: string; note: string; icon: string; target?: "mobile" | "cli"; phone?: Phone };

export function detectInstallPlatform(visitor: Visitor): InstallPlatform {
  const phone = detectPhone(visitor);
  if (phone === "android") return "android";
  const agent = visitor?.userAgent ?? "";
  if (phone === "ios") return /iPad|Macintosh/i.test(agent) ? "ipad" : "iphone";
  if (/Macintosh|Mac OS X/i.test(agent)) return "mac";
  if (/Windows/i.test(agent)) return "windows";
  if (/Linux/i.test(agent)) return "linux";
  return "unknown";
}

const ios = { href: iosDownload, note: "iOS beta · Join in TestFlight", icon: "→", phone: "ios" } as const;
export const installActions: Record<InstallPlatform, InstallAction> = {
  iphone: { ...ios, label: "Get for iPhone" },
  ipad: { ...ios, label: "Get for iPad", note: "iPadOS beta · Join in TestFlight" },
  android: { label: "Get for Android", href: "/more#testflight", note: "Android beta · Google Play access by email", icon: "→", target: "mobile", phone: "android" },
  mac: { label: "Download for Mac", href: runeDownload, note: "Rune alpha · Apple silicon · macOS 14 or later · Apache-2.0 · No account", icon: "↓" },
  linux: { label: "Install for Linux", href: docsHref("/installation"), note: "Linux · CLI and Rune alpha · Apache-2.0 · No account", icon: "→", target: "cli" },
  windows: { label: "Install for Windows", href: docsHref("/installation"), note: "Native desktop · WSL 2 server required · CLI in WSL 2", icon: "↗" },
  unknown: { label: "Choose your platform", href: docsHref("/installation"), note: "Mac, Linux & Windows · Mobile beta available", icon: "↗" },
};

/** Shared hero and closing actions; never guess Mac from the viewport width. */
export function wireDeviceInstall() {
  const platform = detectInstallPlatform(navigator);
  const action = installActions[platform];
  document.documentElement.dataset.installPlatform = platform;
  document.querySelectorAll<HTMLAnchorElement>("[data-device-install]").forEach(link => {
    link.href = action.href;
    link.querySelector("[data-device-label]")!.textContent = action.label;
    link.querySelector("[data-device-icon]")!.textContent = action.icon;
    if (!action.target) return;
    link.addEventListener("click", event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openInstall(action);
    });
  });
  document.querySelector<HTMLElement>(".download-note")!.textContent = action.note;
  // A phone cannot run the shell command displayed in the closing desktop CTA.
  document.querySelector<HTMLElement>(".closing-command")!.hidden = Boolean(action.phone) || platform === "windows";
}

function openInstall(action: InstallAction) {
  const details = document.querySelector<HTMLDetailsElement>("#install-options")!;
  details.open = true;
  details.querySelector<HTMLButtonElement>(`[data-install-target="${action.target}"]`)!.click();
  const form = details.querySelector<HTMLFormElement>("#beta-form")!;
  if (action.phone && form.dataset.phone !== action.phone) {
    details.querySelector<HTMLButtonElement>("#beta-phone")!.click();
  }
  if (action.target === "mobile") {
    // Opening access is not consent to summon the keyboard. Let the visitor choose email.
    details.querySelector<HTMLElement>("[data-email-invite] > summary")!.focus({ preventScroll: true });
    details.scrollIntoView({ block: "center", behavior: "instant" });
    return;
  }
  details.querySelector<HTMLElement>(".install-copy")!.focus();
}
