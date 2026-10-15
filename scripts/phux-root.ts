import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The phux checkout this site publishes from.
 *
 * CI sets PHUX_ROOT. Locally the site repo sits at
 * workspace/no-phux/website, so the product repo is workspace/phux
 * (`../../phux`). A sibling `../phux` works for other layouts.
 */
export function phuxRoot(siteRoot: string): string {
  if (process.env.PHUX_ROOT) return resolve(process.env.PHUX_ROOT);
  const candidates = [resolve(siteRoot, "../../phux"), resolve(siteRoot, "../phux")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "docs")) && existsSync(join(candidate, "scripts/install.sh"))) {
      return candidate;
    }
  }
  throw new Error(
    "set PHUX_ROOT to a phux checkout. Looked for ../../phux and ../phux next to this repo.",
  );
}
