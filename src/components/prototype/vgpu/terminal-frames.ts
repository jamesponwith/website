import type { FabricSession } from "./LiveFabric";
import type { RuntimeState } from "./runtime";
const dim = '\x1b[38;2;132;163;182m', light = '\x1b[38;2;206;228;239m', blue = '\x1b[38;2;159;204;226m', reset = '\x1b[0m';
const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
export function terminalText(value: unknown): string {
  return String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x1f\x7f-\x9f]/g,' ').slice(0,160);
}
const numeric = (value: unknown, fractional = false) => typeof value === 'number' && Number.isFinite(value) ? (fractional ? decimal : integer).format(value) : '—';
function binsFrame(value: unknown) {
  if (!Array.isArray(value)) return 'awaiting samples';
  const values = value.slice(0,8).map(v => typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : 0);
  const maximum = Math.max(1,...values), levels = '▁▂▃▄▅▆▇█';
  return values.map(v => levels[Math.round(v / maximum * 7)]).join(' ');
}
/** These are live application metrics encoded as VT; no invented commands or shell transcript. */
export function workloadFrame(session: FabricSession): string {
  const metrics = session.metrics;
  const programs: Record<string, { title: string; fields: [string,string,boolean?][] }> = {
    compute: { title:'fractal field', fields:[['iterations','totalIterations'],['escaped','escapedCells']] },
    render: { title:'particle field', fields:[['positions','positionsIntegrated'],['energy','energy',true]] },
    signals: { title:'signal spectrum', fields:[['samples','samplesProcessed'],['rms','rms',true]] },
  };
  const program = programs[session.kind] || { title:terminalText(session.kind), fields:[] };
  const state = !session.connected ? 'offline' : session.paused ? 'paused' : 'running';
  const fields = program.fields.map(([label,key,fractional]) => `${dim}${label} ${light}${numeric(metrics[key],fractional)}`);
  return [`${dim}${program.title}`,`${blue}${binsFrame(metrics.bins)}`,...fields,`${dim}${state} · tick ${numeric(session.ticks)}${reset}`].join('\r\n');
}
export function sceneFrame(state: RuntimeState): string {
  const phase = typeof state.sceneTime === 'number' ? `${state.sceneTime.toFixed(1)}s` : `tick ${numeric(state.ticks)}`;
  return `${light}${terminalText(state.lastCommand || 'scene start')}\r\n${dim}${terminalText(state.color)} / ${numeric(state.speed,true)}× / ${phase}${state.paused?' / paused':''}${reset}`;
}
export function snapshotFrame(lines: string[]): string {
  return `${light}${lines.slice(-48).map(terminalText).join('\r\n')}${reset}`;
}
