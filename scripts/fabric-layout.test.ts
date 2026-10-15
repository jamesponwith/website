import { describe, expect, test } from "bun:test";
import { createFabricLayout, fabricGeometryMoved, nearestFabricSlot, reserveFabricOrder, swapFabricOrder, type Point, type Rect } from "../src/components/prototype/vgpu/fabric-layout";
const hosts = [{ id: "studio" }, { id: "render", parentHostId: "studio" }, { id: "edge", parentHostId: "render" }];
const sessions = [
  { id: "scene", hostId: "studio" }, { id: "a", hostId: "studio" }, { id: "b", hostId: "studio" },
  { id: "c", hostId: "render" }, { id: "d", hostId: "edge" },
  { id: "e", hostId: "studio", parentSessionId: "b" }, { id: "f", hostId: "edge", parentSessionId: "e" },
];
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - .01 && a.x + a.w > b.x + .01 && a.y < b.y + b.h - .01 && a.y + a.h > b.y + .01;
function segmentCutsBox(a: Point, b: Point, r: Rect) {
  if (a.x === b.x) return a.x > r.x + .01 && a.x < r.x + r.w - .01 && Math.max(a.y, b.y) > r.y + .01 && Math.min(a.y, b.y) < r.y + r.h - .01;
  return a.y > r.y + .01 && a.y < r.y + r.h - .01 && Math.max(a.x, b.x) > r.x + .01 && Math.min(a.x, b.x) < r.x + r.w - .01;
}
function verifyGeometry(width: number, height: number, hs = hosts, ss = sessions, preferred:Record<string,string[]> = {}) {
  const layout = createFabricLayout(hs, ss, { w: width, h: height }, preferred);
  const boxes = [layout.surface, ...layout.hosts.values(), ...layout.sessions.values()];
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(80);
    expect(box.x + box.w).toBeLessThanOrEqual(width + .01);
    expect(box.y + box.h).toBeLessThan(layout.height - 70);
    for (let j = i + 1; j < boxes.length; j++) expect(overlap(box, boxes[j])).toBe(false);
  }
  for (const [id, route] of layout.routes) {
    expect(route.path).not.toMatch(/NaN|Infinity/);
    for (const point of route.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(layout.height);
    }
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const box of boxes) expect({ id, a, b, box, crosses: segmentCutsBox(a, b, box) }).toMatchObject({ crosses: false });
    }
  }
  return layout;
}
describe("organized fabric geometry", () => {
  test("desktop, tablet, and phone reserve the main view and route through clear gutters", () => {
    for (const [w, h] of [[280, 620], [390, 844], [752, 850], [1024, 768], [1080, 720], [1280, 720], [1512, 982], [2560, 1440]]) verifyGeometry(w, h);
  });
  test("host membership and parent order determine aligned slots instead of arrival scatter", () => {
    const layout = verifyGeometry(1280, 800);
    expect(layout.members.get("studio")).toEqual(["a", "b", "e"]);
    for (const [host, members] of layout.members) {
      const heading = layout.hosts.get(host)!;
      for (const id of members) {
        const card = layout.sessions.get(id)!;
        expect(card.x).toBe(heading.x);
        expect(card.w).toBe(heading.w);
      }
    }
    const second = createFabricLayout(hosts.map(h => ({ ...h })), sessions.map(s => ({ ...s, ticks: Math.random() })), { w: 1280, h: 800 });
    expect(second.sessions).toEqual(layout.sessions);
    expect(second.routes).toEqual(layout.routes);
  });
  test("dragging swaps only valid slots in the same group and keeps every pane separate", () => {
    const original = createFabricLayout(hosts, sessions, { w: 1280, h: 800 });
    const target = original.sessions.get("e")!;
    expect(nearestFabricSlot(original, "a", { x: target.x + target.w / 2, y: target.y + target.h / 2 })).toBe("e");
    const swap = swapFabricOrder(original, "a", "e")!;
    const arranged = verifyGeometry(1280, 800, hosts, sessions, { [swap.hostId]: swap.ids });
    expect(arranged.sessions.get("a")).toEqual(original.sessions.get("e"));
    expect(arranged.sessions.get("e")).toEqual(original.sessions.get("a"));
    expect(swapFabricOrder(original, "a", "c")).toBeNull();
    expect(swapFabricOrder(original, "a", "a")).toBeNull();
    for (const point of [{ x: -1000, y: -1000 }, { x: 10000, y: 10000 }]) expect(original.members.get("studio")).toContain(nearestFabricSlot(original, "a", point));
  });
  test("creation, removal and stale saved orders cannot overlap or lose a pane", () => {
    for (let n = 0; n <= 11; n++) {
      const ss = Array.from({ length: n }, (_, i) => ({ id: `task-${i}`, hostId: hosts[i % hosts.length].id }));
      const layout = verifyGeometry(752, 850, hosts, ss);
      expect(layout.sessions.size).toBe(n);
      const restored = createFabricLayout(hosts, ss, { w: 752, h: 850 }, { studio: ["gone", "task-0", "task-0"] });
      expect(restored.sessions.size).toBe(n);
    }
  });
  test("traffic only waits when existing geometry moves, never for telemetry or new slots", () => {
    const initial = createFabricLayout(hosts, sessions, { w: 1280, h: 800 });
    const same = createFabricLayout(hosts, sessions, { w: 1280, h: 800 });
    expect(fabricGeometryMoved(initial, same)).toBe(false);
    const added = createFabricLayout(hosts, [...sessions, { id: "new", hostId: "render" }], { w: 1280, h: 800 });
    expect(fabricGeometryMoved(initial, added)).toBe(false);
    const reordered = createFabricLayout(hosts, sessions, { w: 1280, h: 800 }, { studio: ["b", "a", "e"] });
    expect(fabricGeometryMoved(initial, reordered)).toBe(true);
    const resized = createFabricLayout(hosts, sessions, { w: 752, h: 850 });
    expect(fabricGeometryMoved(initial, resized)).toBe(true);
  });
  test("a removed middle pane or group keeps its painted slot until its exit finishes", () => {
    const original = [{id:"a",hostId:"studio",ticks:1},{id:"b",hostId:"studio",ticks:1},{id:"c",hostId:"studio",ticks:1}];
    const live = [original[0],{...original[2],ticks:2}];
    const pending = reserveFabricOrder(original,live,[original[1]]);
    expect(pending.map(item=>item.id)).toEqual(["a","b","c"]);
    expect(pending[2].ticks).toBe(2);
    const before = createFabricLayout(hosts,original,{w:1280,h:720});
    const during = createFabricLayout(hosts,pending,{w:1280,h:720});
    expect(during.sessions).toEqual(before.sessions);
    const complete = reserveFabricOrder(pending,live,[]);
    expect(complete.map(item=>item.id)).toEqual(["a","c"]);
    const after = createFabricLayout(hosts,complete,{w:1280,h:720});
    expect(after.sessions.get("c")).toEqual(before.sessions.get("b"));
    const reservedHosts = reserveFabricOrder(hosts,[hosts[0],hosts[2]],[hosts[1]]);
    expect(createFabricLayout(reservedHosts,sessions,{w:1280,h:720}).hosts).toEqual(createFabricLayout(hosts,sessions,{w:1280,h:720}).hosts);
  });
  test("dense groups extend the board instead of compressing or covering other work", () => {
    const dense = Array.from({ length: 11 }, (_, i) => ({ id: `task-${i}`, hostId: "studio" }));
    const layout = verifyGeometry(1280, 720, hosts, dense);
    expect(layout.height).toBeGreaterThan(720);
    for (const card of layout.sessions.values()) expect(card.h).toBe(116);
  });
});
