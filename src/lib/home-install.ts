/** Enhance the server-rendered install dock without moving its hit targets. */
export function wireInstallTargets(copyButton: HTMLButtonElement | null) {
  const install = document.querySelector<HTMLElement>("[data-install]");
  if (!install) return;
  // These IDs are one markup contract, owned by pages/index.astro.
  const code = install.querySelector<HTMLElement>("#install-command")!;
  const note = install.querySelector<HTMLElement>("#install-note")!;
  const status = install.querySelector<HTMLElement>("#beta-note")!;
  const tabs = install.querySelector<HTMLElement>(".install-tabs")!;
  const line = install.querySelector<HTMLElement>(".install-line")!;
  const request = install.querySelector<HTMLElement>(".install-request")!;
  const commandBox = install.querySelector<HTMLElement>(".install-command")!;
  const download = install.querySelector<HTMLElement>("#install-download")!;
  const targets = [...install.querySelectorAll<HTMLButtonElement>("[data-install-target]")];
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let active = targets[0];

  const placePill = (target: HTMLButtonElement) => {
    const frame = tabs.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    tabs.style.setProperty("--pill-x", `${box.left - frame.left}px`);
    tabs.style.setProperty("--pill-width", `${box.width}px`);
  };
  const settle = (element: HTMLElement, distance: number, duration: number) => {
    if (still.matches) return;
    element.animate(
      [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: "none" }],
      { duration, easing: "cubic-bezier(.22,.61,.36,1)" },
    );
  };
  const swap = (target: HTMLButtonElement) => {
    if (target === active) return;
    active = target;
    status.textContent = "";
    targets.forEach(candidate => candidate.setAttribute("aria-pressed", String(candidate === target)));
    const command = target.dataset.installCommand ?? "";
    const mobile = command === "";
    const desktop = target.dataset.installTarget === "rune";
    code.textContent = command;
    note.textContent = target.dataset.installNote ?? "";
    setInstallCopy(copyButton, command, desktop);
    line.hidden = mobile;
    request.hidden = !mobile;
    commandBox.hidden = desktop;
    download.hidden = !desktop;
    placePill(target);
    const preview = installPreview(mobile, desktop, request, download, code);
    settle(preview.element, preview.distance, preview.duration);
    settle(note, 4, 340);
  };
  targets.forEach((target, index) => {
    target.addEventListener("pointerenter", () => swap(target));
    target.addEventListener("focus", () => swap(target));
    target.addEventListener("click", () => swap(target));
    target.addEventListener("keydown", event => {
      const step = arrowStep(event.key);
      if (step === 0) return;
      event.preventDefault();
      const next = targets[(index + step + targets.length) % targets.length];
      next.focus();
      swap(next);
    });
  });
  // Font loading and resize may change tab widths; target swaps never do.
  const relayout = () => placePill(active);
  install.closest("details")?.addEventListener("toggle", relayout);
  relayout();
  requestAnimationFrame(relayout);
  document.fonts?.ready.then(relayout);
  addEventListener("resize", relayout);
  addEventListener("load", relayout);
}

function setInstallCopy(button: HTMLButtonElement | null, command: string, desktop: boolean) {
  if (!button) return;
  button.dataset.copy = command;
  button.dataset.label = desktop ? "Copy curl" : "Copy";
  button.textContent = button.dataset.label;
}

function arrowStep(key: string): number {
  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  return 0;
}

function installPreview(mobile: boolean, desktop: boolean, request: HTMLElement, download: HTMLElement, code: HTMLElement) {
  if (mobile) return { element: request, distance: 4, duration: 340 };
  if (desktop) return { element: download, distance: 6, duration: 420 };
  return { element: code, distance: 6, duration: 420 };
}
