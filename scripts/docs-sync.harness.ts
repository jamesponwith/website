// Shared fixture for the docs sync tests: a fresh temp root and source dir
// per test, a silenced console.warn to assert on, and the render helpers.
import { afterEach, beforeEach, spyOn } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Entry } from "./docs-catalog";
import { createPageRenderer } from "./docs-markdown";

export const revision = "a".repeat(40);
export const siteRevision = "b".repeat(40);
export const versions = { protocolVersion: "1.2.3", projectVersion: "0.4.5" };

/** Per-test state; `useDocsSyncRoot()` refreshes it before every test. */
export const state = {
  root: "",
  docs: "",
  warning: undefined as unknown as ReturnType<typeof spyOn>,
};

export function useDocsSyncRoot() {
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), "phux-docs-sync-"));
    state.docs = join(state.root, "custom-source");
    await mkdir(state.docs);
    state.warning = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    state.warning.mockRestore();
    await rm(state.root, { recursive: true, force: true });
  });
}

export async function source(file: string, body = "# Title\n\nA summary.\n\n## Detail\n\nText.\n") {
  const path = join(state.docs, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

export async function metadata(out: string, folder = "") {
  return JSON.parse(await readFile(join(out, folder, "meta.json"), "utf8"));
}

export const entry: Entry = { repoPath: "docs/clients.md", abs: "/unused", slug: "clients", group: "connect", order: 1 };

export function render(body: string, entries = [entry]) {
  return createPageRenderer(entries, revision, versions)(body, entry);
}
