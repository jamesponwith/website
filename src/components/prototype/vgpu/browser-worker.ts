import { BrowserEngine } from "./browser-engine";
const engine = new BrowserEngine();
let visible = true;
let timer: ReturnType<typeof setTimeout>;
function schedule() {
  clearTimeout(timer);
  if (!visible) return;
  timer = setTimeout(() => { engine.tick(); schedule(); }, 500);
}
globalThis.addEventListener("message", (event: MessageEvent) => {
  const data = event.data;
  if (data.type === "visibility") { visible = Boolean(data.visible); engine.setVisible(visible); schedule(); return; }
  if (data.type === "restore") { engine.restoreScene(data.scene); return; }
  if (data.type !== "request") return;
  const result = engine.request(data.path, data.method, data.body);
  globalThis.postMessage({ id: data.id, ...result });
});
schedule();
