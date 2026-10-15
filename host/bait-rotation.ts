/** Private policy consumption; missing or invalid ops data never enables bait. */
import type { AnalyticsEnv } from "./analytics";
import type { TrapKind, TrapRule } from "./tripwire-paths";
import { readPrefix } from "./read-prefix";

export interface SiteRotation {
  rotationId: string;
  depthDelayMs: number;
  expiresAt: number;
  cohortFingerprint: string;
  rules: TrapRule[];
  envBody: string;
  gitBody: string;
  wpLoginBody: string;
  wpLoginRedirect: string;
}

const CACHE_TTL_MS = 60_000;
type Binding = NonNullable<AnalyticsEnv["ANALYTICS"]>;
let cache = new WeakMap<Binding, { rotation: SiteRotation; fetchedAt: number }>();

export function resetRotationCache(): void {
  cache = new WeakMap();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isLocalPath(value: unknown): value is string {
  if (!isText(value, 2048)) return false;
  return /^\/(?!\/)[^\s?#\\]*$/.test(value);
}

function isRule(value: unknown): value is TrapRule {
  if (!isRecord(value)) return false;
  if (!isLocalPath(value.path)) return false;
  if (value.path !== value.path.toLowerCase()) return false;
  if (!["exact", "prefix"].includes(value.match as string)) return false;
  return ["env", "git", "wp-login", "robots-bait", "probe"].includes(value.trap as TrapKind);
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  if (typeof value !== "number") return false;
  return Number.isFinite(value) && value >= min && value <= max;
}

function parsePayload(payload: unknown): Omit<SiteRotation, "rotationId" | "depthDelayMs" | "expiresAt"> | undefined {
  if (!isRecord(payload)) return undefined;
  if (!isText(payload.cohortFingerprint, 256)) return undefined;
  if (!Array.isArray(payload.rules)) return undefined;
  if (payload.rules.length === 0 || payload.rules.length > 256) return undefined;
  if (!payload.rules.every(isRule)) return undefined;
  const bodies = [payload.envBody, payload.gitBody, payload.wpLoginBody];
  if (!bodies.every((body) => isText(body, 65_536))) return undefined;
  if (!isLocalPath(payload.wpLoginRedirect)) return undefined;
  return {
    cohortFingerprint: payload.cohortFingerprint,
    rules: payload.rules,
    envBody: payload.envBody as string,
    gitBody: payload.gitBody as string,
    wpLoginBody: payload.wpLoginBody as string,
    wpLoginRedirect: payload.wpLoginRedirect,
  };
}

function parseRotation(value: unknown, now: number): SiteRotation | undefined {
  if (!isRecord(value)) return undefined;
  if (!isText(value.rotationId, 64)) return undefined;
  if (!/^[a-zA-Z0-9_-]+$/.test(value.rotationId)) return undefined;
  if (!isBoundedNumber(value.depthDelayMs, 0, 12_000)) return undefined;
  if (!isBoundedNumber(value.expiresAt, now + 1, Number.MAX_SAFE_INTEGER)) return undefined;
  const payload = parsePayload(value.payload);
  if (!payload) return undefined;
  return { rotationId: value.rotationId, depthDelayMs: value.depthDelayMs, expiresAt: value.expiresAt, ...payload };
}

export async function getRotation(env: AnalyticsEnv): Promise<SiteRotation | undefined> {
  const binding = env.ANALYTICS;
  if (!binding) return undefined;
  const now = Date.now();
  const cached = cache.get(binding);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS && cached.rotation.expiresAt > now) return cached.rotation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fetchRotation(binding),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("rotation timeout")), 1500);
      }),
    ]);
    const rotation = parseRotation(value, Date.now());
    if (!rotation) return undefined;
    cache.set(binding, { rotation, fetchedAt: now });
    return rotation;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRotation(binding: Binding): Promise<unknown> {
  const response = await binding.fetch(new Request("https://analytics.internal/api/bait/current"));
  if (!response.ok) return undefined;
  return JSON.parse(await readPrefix(response.body, 262_144));
}
