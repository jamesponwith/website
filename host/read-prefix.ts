/** Capture a bounded prefix without buffering an attacker-controlled body. */
export async function readPrefix(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const bytes = new Uint8Array(limit);
  let length = 0;
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 1000);
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, limit - length);
      bytes.set(part, length);
      length += part.byteLength;
    }
    return new TextDecoder().decode(bytes.subarray(0, length));
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
