import { gazeBlend, gazeOffset } from "./gaze";

/** Where the fox's head sits in its frame at rest, as fractions of the box. */
const HEAD = { x: 0.62, y: 0.38 };

/**
 * Follow the pointer with an eased gaze and hand it to `onLook` as -1..1.
 * The latest value is mirrored in `data-look` for checks.
 */
export function trackFox(el: HTMLElement, onLook: (x: number, y: number) => void = () => {}) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false;
  let frame = 0;
  let previous = 0;
  let current = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };

  function paint() {
    const x = current.x / 3.2, y = current.y / 2.2;
    el.dataset.look = `${+x.toFixed(4)} ${+y.toFixed(4)}`;
    onLook(x, y);
  }

  function settle() {
    cancelAnimationFrame(frame);
    frame = 0;
    current = target = { x: 0, y: 0 };
    paint();
  }

  function animate(now: number) {
    const blend = gazeBlend(now - previous);
    previous = now;
    current.x += (target.x - current.x) * blend;
    current.y += (target.y - current.y) * blend;
    paint();
    frame = 0;
    if (Math.hypot(target.x - current.x, target.y - current.y) > .001) {
      frame = requestAnimationFrame(animate);
    }
  }

  function look(next: typeof target) {
    target = next;
    if (frame) return;
    previous = performance.now();
    frame = requestAnimationFrame(animate);
  }

  function follow(event: PointerEvent) {
    if (!visible || motion.matches || event.pointerType === "touch") return;
    const box = el.getBoundingClientRect();
    if (!box.width) return;
    // Measured in the old 620-wide frame so gazeOffset keeps its feel.
    const unit = 620 / box.width;
    look(gazeOffset((event.clientX - box.left - HEAD.x * box.width) * unit, (event.clientY - box.top - HEAD.y * box.height) * unit));
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry!.isIntersecting;
    if (!visible) settle();
  });
  paint();
  observer.observe(el);
  window.addEventListener("pointermove", follow, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => look({ x: 0, y: 0 }));
  document.addEventListener("visibilitychange", settle);
  motion.addEventListener("change", settle);
}
