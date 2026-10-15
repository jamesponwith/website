/** Geometry is computed only when topology, viewport, or an explicit order changes. */
export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };
export type Place = Rect;
export type LayoutHost = { id: string; parentHostId?: string | null };
export type LayoutSession = { id: string; hostId: string; parentSessionId?: string | null };
export type WireRoute = { points: Point[]; path: string; start: Point; end: Point };
export type FabricLayout = {
  width: number; height: number; stacked: boolean; surface: Rect;
  groups: Map<string, Rect>; hosts: Map<string, Rect>; sessions: Map<string, Rect>;
  members: Map<string, string[]>; routes: Map<string, WireRoute>; places: Map<string, Place>;
};
const midX = (r: Rect) => r.x + r.w / 2;
const midY = (r: Rect) => r.y + r.h / 2;
const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const topPort = (r: Rect): Point => ({ x: midX(r), y: r.y });
const bottomPort = (r: Rect): Point => ({ x: midX(r), y: bottom(r) });
const leftPort = (r: Rect): Point => ({ x: r.x, y: midY(r) });
const rightPort = (r: Rect): Point => ({ x: right(r), y: midY(r) });

/** Parent before descendants, keeping creation order for siblings and disconnected roots. */
function familyOrder<T extends { id: string }>(items: T[], parent: (item: T) => string | null | undefined): T[] {
  const result: T[] = [], seen = new Set<string>();
  const visit = (item: T) => {
    if (seen.has(item.id)) return;
    seen.add(item.id); result.push(item);
    items.filter(child => parent(child) === item.id).forEach(visit);
  };
  items.filter(item => !items.some(candidate => candidate.id === parent(item))).forEach(visit);
  items.forEach(visit);
  return result;
}
function orderMembers(items: LayoutSession[], preferred: string[]) {
  const natural = familyOrder(items, item => item.parentSessionId);
  const known = new Map(natural.map(item => [item.id, item]));
  const ordered = [...new Set(preferred)].flatMap(id => known.has(id) ? [known.get(id)!] : []);
  return [...ordered, ...natural.filter(item => !preferred.includes(item.id))];
}
function viewportFrame(width: number, height: number) {
  const stacked = width < 1080;
  const pad = Math.max(24, Math.min(72, width * .045));
  const surfaceWidth = stacked ? Math.min(560, width - pad * 2) : Math.min(680, width * .42);
  const surfaceHeight = stacked ? Math.max(220, Math.min(290, surfaceWidth * .49)) : Math.max(260, Math.min(360, height * .43));
  const surface = { x: stacked ? (width - surfaceWidth) / 2 : pad, y: stacked ? 100 : Math.max(120, (height - surfaceHeight) / 2), w: surfaceWidth, h: surfaceHeight };
  const x = stacked ? pad : right(surface) + 64;
  return { stacked, surface, board: { x, y: stacked ? bottom(surface) + 60 : 116, w: width - pad - x }, pad };
}
/** Rounded Manhattan paths use the reserved column gutters and group-row gaps. */
export function roundedWire(points: Point[], radius = 9): WireRoute {
  const clean = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  const simple = clean.filter((p, i) => !i || i === clean.length - 1 || !((clean[i - 1].x === p.x && p.x === clean[i + 1].x) || (clean[i - 1].y === p.y && p.y === clean[i + 1].y)));
  let path = `M${simple[0].x},${simple[0].y}`;
  for (let i = 1; i < simple.length - 1; i++) {
    const previous = simple[i - 1], p = simple[i], next = simple[i + 1];
    const before = Math.hypot(p.x - previous.x, p.y - previous.y), after = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, before / 2, after / 2);
    const a = { x: p.x + (previous.x - p.x) * r / before, y: p.y + (previous.y - p.y) * r / before };
    const b = { x: p.x + (next.x - p.x) * r / after, y: p.y + (next.y - p.y) * r / after };
    path += ` L${a.x},${a.y} Q${p.x},${p.y} ${b.x},${b.y}`;
  }
  const end = simple.at(-1)!;
  return { points: simple, path: `${path} L${end.x},${end.y}`, start: simple[0], end };
}
function groupConnection(a: Rect, b: Rect, outer: number) {
  const start = topPort(a), end = topPort(b), aRail = a.y - 22, bRail = b.y - 22;
  if (a.y === b.y) return roundedWire([start, { x: start.x, y: aRail }, { x: end.x, y: aRail }, end]);
  return roundedWire([start, { x: start.x, y: aRail }, { x: outer, y: aRail }, { x: outer, y: bRail }, { x: end.x, y: bRail }, end]);
}
function memberConnection(host: Rect, card: Rect, first: boolean) {
  if (first) return roundedWire([bottomPort(host), topPort(card)]);
  const start = leftPort(host), end = leftPort(card), rail = card.x - 10;
  return roundedWire([start, { x: rail, y: start.y }, { x: rail, y: end.y }, end]);
}
function branchConnection(a: Rect, b: Rect, groupA: Rect, groupB: Rect, outer: number) {
  if (groupA === groupB) {
    if (Math.abs(bottom(a) + 14 - b.y) < 1) return roundedWire([bottomPort(a), topPort(b)]);
    const start = rightPort(a), end = rightPort(b), rail = right(a) + 10;
    return roundedWire([start, { x: rail, y: start.y }, { x: rail, y: end.y }, end]);
  }
  const start = rightPort(a), end = leftPort(b), aRail = right(groupA) + 10, bRail = groupB.x - 10;
  return roundedWire([start, { x: aRail, y: start.y }, { x: aRail, y: groupA.y - 22 }, { x: outer, y: groupA.y - 22 }, { x: outer, y: groupB.y - 22 }, { x: bRail, y: groupB.y - 22 }, { x: bRail, y: end.y }, end]);
}
function connectLayout(layout: FabricLayout, hosts: LayoutHost[], sessions: LayoutSession[], outer: number) {
  for (const host of hosts) {
    const box = layout.hosts.get(host.id)!, parent = layout.hosts.get(host.parentHostId || "");
    let route: WireRoute;
    if (parent) route = groupConnection(parent, box, outer);
    else if (layout.stacked) {
      const start = bottomPort(layout.surface), end = topPort(box), rail = box.y - 30;
      route = roundedWire([start, { x: start.x, y: rail }, { x: end.x, y: rail }, end]);
    } else {
      const start = rightPort(layout.surface), end = leftPort(box);
      route = roundedWire([start, { x: outer, y: start.y }, { x: outer, y: end.y }, end]);
    }
    layout.routes.set(`host-${host.id}`, route);
  }
  for (const session of sessions) {
    const card = layout.sessions.get(session.id)!, host = layout.hosts.get(session.hostId)!;
    const parent = sessions.find(candidate => candidate.id === session.parentSessionId);
    const parentCard = parent && layout.sessions.get(parent.id);
    const route = parentCard
      ? branchConnection(parentCard, card, layout.groups.get(parent.hostId)!, layout.groups.get(session.hostId)!, outer)
      : memberConnection(host, card, layout.members.get(session.hostId)![0] === session.id);
    layout.routes.set(session.id, route);
  }
}
export function createFabricLayout(hostInput: LayoutHost[], sessionInput: LayoutSession[], size: { w: number; h: number }, preferred: Record<string, string[]> = {}): FabricLayout {
  const width = Math.max(280, size.w), height = Math.max(620, size.h);
  const { stacked, surface, board } = viewportFrame(width, height);
  const hosts = familyOrder(hostInput, host => host.parentHostId);
  const sessions = sessionInput.filter(session => session.id !== "scene" && hosts.some(host => host.id === session.hostId));
  const gap = 24, cardHeight = width < 600 ? 104 : 116;
  const columns = Math.max(1, Math.min(3, Math.floor((board.w + gap) / (146 + gap))));
  const cardWidth = (board.w - gap * (columns - 1)) / columns;
  const layout: FabricLayout = { width, height, stacked, surface, groups: new Map(), hosts: new Map(), sessions: new Map(), members: new Map(), routes: new Map(), places: new Map() };
  let y = board.y;
  for (let offset = 0; offset < hosts.length; offset += columns) {
    const row = hosts.slice(offset, offset + columns);
    let rowHeight = 30;
    row.forEach((host, column) => {
      const members = orderMembers(sessions.filter(session => session.hostId === host.id), preferred[host.id] || []);
      const x = board.x + column * (cardWidth + gap), groupHeight = 30 + members.length * (cardHeight + 14);
      layout.groups.set(host.id, { x, y, w: cardWidth, h: groupHeight });
      layout.hosts.set(host.id, { x, y, w: cardWidth, h: 30 });
      layout.members.set(host.id, members.map(session => session.id));
      members.forEach((session, index) => layout.sessions.set(session.id, { x, y: y + 44 + index * (cardHeight + 14), w: cardWidth, h: cardHeight }));
      rowHeight = Math.max(rowHeight, groupHeight);
    });
    y += rowHeight + 44;
  }
  layout.height = Math.max(height, y - 44 + 120);
  connectLayout(layout, hosts, sessions, Math.max(10, board.x - 28));
  layout.sessions.forEach((rect, id) => layout.places.set(id, { x: rect.x / width * 100, y: rect.y / layout.height * 100, w: rect.w / width * 100, h: rect.h / layout.height * 100 }));
  return layout;
}
/** A drag may reorder a group's views; it never silently migrates the actual workload. */
export function nearestFabricSlot(layout: FabricLayout, sessionId: string, point: Point): string {
  const members = [...layout.members.values()].find(ids => ids.includes(sessionId)) || [];
  return members.reduce((nearest, id) => {
    const a = layout.sessions.get(id)!, b = layout.sessions.get(nearest)!;
    return Math.hypot(midX(a) - point.x, midY(a) - point.y) < Math.hypot(midX(b) - point.x, midY(b) - point.y) ? id : nearest;
  }, sessionId);
}
export function swapFabricOrder(layout: FabricLayout, from: string, to: string): { hostId: string; ids: string[] } | null {
  for (const [hostId, members] of layout.members) {
    if (!members.includes(from) || !members.includes(to) || from === to) continue;
    const ids = [...members], a = ids.indexOf(from), b = ids.indexOf(to);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    return { hostId, ids };
  }
  return null;
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
/** New slots may draw in immediately; moved existing views settle before traffic resumes. */
export function fabricGeometryMoved(previous: FabricLayout, next: FabricLayout): boolean {
  if (!sameRect(previous.surface, next.surface)) return true;
  const moved = (before: Map<string, Rect>, after: Map<string, Rect>) => [...before].some(([id, rect]) => after.has(id) && !sameRect(rect, after.get(id)!));
  return moved(previous.hosts, next.hosts) || moved(previous.sessions, next.sessions);
}

/** Keep fading views in their painted slots; live telemetry always wins over cached objects. */
export function reserveFabricOrder<T extends { id: string }>(painted: T[], current: T[], departing: T[]): T[] {
  const values = new Map([...departing, ...current].map(item => [item.id, item]));
  const order = [...new Set([...painted, ...current, ...departing].map(item => item.id))];
  return order.flatMap(id => values.has(id) ? [values.get(id)!] : []);
}
