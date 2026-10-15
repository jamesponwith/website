import { expect, test } from "bun:test";
import { readPrefix } from "./read-prefix";

test("prefix capture caps bytes and cancels the rest of the stream", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(4096))); },
    cancel() { cancelled = true; },
  });
  expect(await readPrefix(body, 1024)).toHaveLength(1024);
  expect(cancelled).toBe(true);
  expect(await readPrefix(null, 1024)).toBe("");
});
