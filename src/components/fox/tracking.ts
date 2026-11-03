import { gazeBlend, gazeOffset } from "./gaze";

export function trackFox(svg: SVGSVGElement) {
  const lean = svg.querySelector<SVGGElement>("[data-fox-look]")!;
  const turn = svg.querySelector<SVGGElement>("[data-fox-turn]")!;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false;
  let frame = 0;
  let previous = 0;
  let current = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };

  function paint() {
    // The emblem leans toward the pointer: a small shift plus a turn.
    lean.setAttribute("transform", `translate(${current.x * 4} ${current.y * 4})`);
    turn.setAttribute("transform", `rotate(${current.x * 1.8} 310 210)`);
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
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    look(gazeOffset(point.x - 310, point.y - 210));
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry!.isIntersecting;
    if (!visible) settle();
  });
  paint();
  observer.observe(svg);
  window.addEventListener("pointermove", follow, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => look({ x: 0, y: 0 }));
  document.addEventListener("visibilitychange", settle);
  motion.addEventListener("change", settle);
}
