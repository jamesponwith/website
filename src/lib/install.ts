// The curl installers and the claims the homepage makes about them. Every
// claim here is checked against the published script (phux scripts/install.sh):
// it verifies the release SHA-256 (and its minisign signature when minisign is
// present) before installing, never calls sudo, defaults to ~/.local/bin, and
// both installers forward `--dry-run`.
import { SITE } from "./site";

export const cliInstall = "curl -fsSL https://phux.sh/install | sh";
export const desktopInstall = "curl -fsSL https://phux.sh/install-desktop | sh";
/** Phux Rune, the desktop client: the same installer with --rune. */
export const runeInstall = "curl -fsSL https://phux.sh/install | sh -s -- --rune";
export const installScriptSource = `${SITE.github}/blob/main/scripts/install.sh`;

export type InstallTarget = { id: "cli" | "rune" | "mobile"; label: string; command: string; note: string };

/**
 * The CLI is a command. Rune, the desktop client, is a download, with its
 * installer kept as the terminal (and Linux) alternative. The mobile target swaps in the beta request.
 */
export const installTargets: InstallTarget[] = [
  { id: "cli", label: "CLI", command: cliInstall, note: "macOS and Linux · installs phux and phux-mcp" },
  { id: "rune", label: "Rune", command: runeInstall, note: "Apple-silicon Mac (macOS 14+) · or install from a terminal on macOS or x86_64 Linux. Installs the phux CLI too if none is found." },
  { id: "mobile", label: "Mobile", command: "", note: "No install: open the demo, press Enter, scan the QR, then drive the shell from your phone. Beta: TestFlight on iPhone, Google Play testing on Android." },
];

/** The latest Apple-silicon Rune DMG; the site worker resolves it per click (host/download.ts). */
export const runeDownload = "/download/rune";
/** Existing enabled public TestFlight group, resolved by the site Worker. */
export const iosDownload = "/download/ios";

/** Pending a real-Mac check. Delete this line if that Mac shows no confirmation dialog. */
export const desktopFirstOpen = "First open: macOS asks to confirm an app downloaded from the internet. Choose Open.";

/** The same installer, told to print its plan and install nothing. */
export function dryRun(command: string) {
  if (command.endsWith("| sh")) return `${command} -s -- --dry-run`;
  return command.includes("| sh -s --") ? `${command} --dry-run` : command;
}
