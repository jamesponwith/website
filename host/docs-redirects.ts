/**
 * Retired docs URLs. Astro serves these as HTML meta-refresh pages.
 * The worker sends `<path>.md` to the canonical page instead, because a
 * cached 301 must not stop on that stub.
 *
 * `/quickstart` and `/build-on` are also worker alias rules (host/routes.ts).
 * `/concepts/when-to-use` prefers /compare once that page is published.
 */
export const WORKER_DOC_ALIASES = {
  "/quickstart": "/getting-started",
  "/build-on": "/building",
} as const;

export const DOC_REDIRECTS = {
  ...WORKER_DOC_ALIASES,
  "/quickstart/install": "/installation",
  "/quickstart/config": "/config",
  "/concepts/coming-from": "/getting-started",
  "/concepts/vision": "/architecture",
  "/remote-access": "/remote",
  "/consumers": "/clients",
  "/wire": "/protocol",
  "/consumers/agents/cli": "/scripting",
  "/consumers/agents/targeting": "/scripting",
  "/consumers/agents/json": "/scripting",
  "/consumers/agents/integrations": "/scripting",
  "/consumers/agents": "/scripting",
  "/consumers/attention": "/agents",
  "/consumers/harness": "/agents",
  "/consumers/mission": "/agents",
  "/consumers/mcp": "/agents",
  "/consumers/claude": "/agents",
  "/consumers/grok": "/agents",
  "/consumers/omp": "/agents",
  "/consumers/opencode-v2": "/agents",
  "/consumers/pi": "/agents",
  "/consumers/pi-in-60-seconds": "/agents",
  "/consumers/getting-started": "/agents",
  "/consumers/android": "/clients",
  "/consumers/ios": "/clients",
  "/consumers/cockpit": "/clients",
  "/consumers/desktop": "/clients",
  "/consumers/web": "/clients",
  "/consumers/tui": "/getting-started",
  "/consumers/tui/commands": "/getting-started",
  "/consumers/tui/configuration": "/getting-started",
  "/consumers/tui/interface": "/getting-started",
  "/consumers/tui/automation": "/getting-started",
  "/consumers/tui/reference": "/getting-started",
  "/consumers/recording": "/getting-started",
  "/consumers/build-a-client": "/protocol",
  "/consumers/sdk": "/protocol",
  "/wire/changelog": "/protocol",
  "/wire/l1": "/protocol",
  "/wire/l2": "/protocol",
  "/wire/l3": "/protocol",
  "/wire/tutorial": "/protocol",
  "/wire/appendix-encoding": "/protocol",
  "/wire/appendix-reserved": "/protocol",
  "/wire/coordinator": "/protocol",
  "/wire/input": "/protocol",
  "/wire/proto": "/protocol",
  "/wire/workload-auth": "/protocol",
  "/architecture/diagram": "/architecture",
  "/architecture/client-runtime": "/architecture",
  "/architecture/crate-graph": "/architecture",
  "/architecture/data-model": "/architecture",
  "/architecture/declared-producers": "/architecture",
  "/architecture/defguard-federation": "/architecture",
  "/architecture/desktop-verification": "/architecture",
  "/architecture/desktop": "/architecture",
  "/architecture/module-structure": "/architecture",
  "/architecture/phux-and-herdr": "/architecture",
  "/architecture/predictive-echo": "/architecture",
  "/architecture/process-model": "/architecture",
  "/architecture/render-layering": "/architecture",
  "/architecture/state-sync": "/architecture",
  "/architecture/threading": "/architecture",
  "/architecture/transport": "/architecture",
  "/architecture/usage-collector": "/architecture",
  "/architecture/verification": "/architecture",
  "/architecture/operations": "/troubleshooting",
} as const;

export type DocRedirectPath = keyof typeof DOC_REDIRECTS;

/**
 * Pages to try for a markdown alias, in order.
 * `/concepts/when-to-use` is probed here on each request. `docsRedirects`
 * picks that same choice once, when the HTML stub is built. The markdown
 * response is therefore a 302: a cached 301 to `/concepts.md` would outlive
 * the compare page shipping.
 */
export function docAliasCandidates(pathname: string): readonly string[] {
  if (pathname === "/concepts/when-to-use") return ["/compare", "/concepts"];
  const target = DOC_REDIRECTS[pathname as DocRedirectPath];
  return target ? [target] : [];
}

/** The redirect map Astro builds. Compare is included only when that page exists. */
export function docsRedirects(comparePublished: boolean): Record<string, string> {
  return {
    ...DOC_REDIRECTS,
    "/concepts/when-to-use": comparePublished ? "/compare" : "/concepts",
  };
}
