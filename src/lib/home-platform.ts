import { detectPhone, type Phone } from "./beta";
import { iosDownload, linuxArches, runeDownload, runeInstall, runeLinuxRequirements, type LinuxArch } from "./install";
import { docsHref } from "./site";

export type InstallPlatform = "iphone" | "ipad" | "android" | "mac" | "linux" | "windows" | "unknown";
type Visitor = Parameters<typeof detectPhone>[0];
type InstallAction = { label: string; href: string; note: string; icon: string; target?: "mobile" | "cli"; phone?: Phone; copy?: string };

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

type ArchHints = { architecture?: string; bitness?: string };
type LinuxVisitor = {
  userAgent?: string;
  platform?: string;
  userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<ArchHints> };
};

/**
 * Which Rune tarball this Linux browser can run, or null when it cannot say.
 * Only a positive signal counts: Chrome's frozen user agent reads "Linux
 * x86_64" on every Linux, so that string alone never picks x86_64.
 */
export async function detectLinuxArch(visitor: LinuxVisitor | undefined): Promise<LinuxArch | null> {
  if (/\b(aarch64|arm64)\b/i.test(`${visitor?.userAgent ?? ""} ${visitor?.platform ?? ""}`)) return "aarch64";
  try {
    const hints = await visitor?.userAgentData?.getHighEntropyValues?.(["architecture", "bitness"]);
    if (hints?.bitness !== "64") return null;
    if (hints.architecture === "arm") return "aarch64";
    if (hints.architecture === "x86") return "x86_64";
  } catch {
    // Client hints are optional; no answer means offer both archives.
  }
  return null;
}

const ios = { href: iosDownload, note: "iOS beta · Join in TestFlight", icon: "→", phone: "ios" } as const;
export const installActions: Record<InstallPlatform, InstallAction> = {
  iphone: { ...ios, label: "Get for iPhone" },
  ipad: { ...ios, label: "Get for iPad", note: "iPadOS beta · Join in TestFlight" },
  android: { label: "Get for Android", href: "/more#testflight", note: "Android beta · Google Play access by email", icon: "→", target: "mobile", phone: "android" },
  mac: { label: "Download for Mac", href: runeDownload, note: "Phux Rune · Apple silicon · macOS 14 or later · Apache-2.0 · No account", icon: "↓" },
  linux: { label: "Copy install for Linux", href: "#linux-rune", note: `Phux Rune desktop app · x86_64 or arm64 · ${runeLinuxRequirements} · Installs the CLI too · Apache-2.0`, icon: "⧉", copy: runeInstall },
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
    if (!action.target && !action.copy) return;
    link.addEventListener("click", event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (action.copy) void copyCommand(action.copy, link.querySelector("[data-device-label]"));
      else openInstall(action);
    });
  });
  document.querySelector<HTMLElement>(".download-note")!.textContent = action.note;
  // A phone cannot run the shell command displayed in the closing desktop CTA.
  document.querySelector<HTMLElement>(".closing-command")!.hidden = Boolean(action.phone) || platform === "windows";
  if (platform === "linux") void wireLinuxRune();
}

/** Linux leads with Rune: its one-line installer, then the tarball for this CPU. */
async function wireLinuxRune() {
  document.querySelector<HTMLElement>(".closing-command code")!.textContent = runeInstall;
  const panel = document.querySelector<HTMLElement>("[data-linux-rune]")!;
  panel.hidden = false;
  const copy = panel.querySelector<HTMLButtonElement>("[data-linux-copy]")!;
  copy.addEventListener("click", () => void copyCommand(runeInstall, copy));
  const arch = await detectLinuxArch(navigator as LinuxVisitor);
  panel.dataset.linuxArch = arch ?? "unknown";
  for (const candidate of linuxArches) {
    panel.querySelector<HTMLElement>(`[data-linux-archive="${candidate}"]`)!.hidden = arch !== null && arch !== candidate;
  }
}

async function copyCommand(command: string, label: Element | null) {
  const status = document.querySelector<HTMLElement>("[data-linux-status]");
  try {
    await navigator.clipboard.writeText(command);
    if (status) status.textContent = "Install command copied. Paste it into a terminal.";
    if (!label) return;
    const text = label.textContent;
    label.textContent = "Copied ✓";
    setTimeout(() => { label.textContent = text; }, 1400);
  } catch {
    if (status) status.textContent = "Could not copy. Select the command to copy it manually.";
  }
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
