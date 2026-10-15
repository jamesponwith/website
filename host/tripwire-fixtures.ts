import type { SiteRotation } from "./bait-rotation";

/** Synthetic policy only; never copy the private production catalog here. */
export function syntheticRotation(): SiteRotation {
  return {
    rotationId: "test-rotation",
    depthDelayMs: 0,
    expiresAt: Date.now() + 60_000,
    cohortFingerprint: "test-cohort",
    rules: [
      { path: "/fixture/settings", match: "exact", trap: "env" },
      { path: "/fixture/repo/", match: "prefix", trap: "git" },
      { path: "/fixture/login", match: "exact", trap: "wp-login" },
      { path: "/fixture/signal/", match: "prefix", trap: "robots-bait" },
      { path: "/fixture/probe", match: "exact", trap: "probe" },
    ],
    envBody: "synthetic settings response",
    gitBody: "synthetic repository response",
    wpLoginBody: "<p>synthetic form response</p>",
    wpLoginRedirect: "/fixture/probe",
  };
}

export function rotationPayload(rotation = syntheticRotation()) {
  const { rotationId, depthDelayMs, expiresAt, ...payload } = rotation;
  return { rotationId, depthDelayMs, expiresAt, payload };
}
