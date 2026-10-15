/** Generic matcher: policy values arrive only through the private binding. */
export type TrapKind = "env" | "git" | "wp-login" | "robots-bait" | "probe";
export interface TrapRule {
  path: string;
  match: "exact" | "prefix";
  trap: TrapKind;
}
export function classifyTrap(pathname: string, rules: readonly TrapRule[]): TrapKind | null {
  const path = pathname.toLowerCase();
  for (const rule of rules) {
    const matches = rule.match === "exact" ? path === rule.path : path.startsWith(rule.path);
    if (matches) return rule.trap;
  }
  return null;
}
