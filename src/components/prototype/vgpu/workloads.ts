// Pure numerical workloads shared by native PTYs and the browser Worker.
export type WorkloadKind = "render" | "compute" | "signals";
export type WorkloadMetrics = Record<string, number | string | number[]>;
const rounded = (value: number) => Math.round(value * 1e5) / 1e5;

function particleField() {
  const count = 768;
  const positions = Float64Array.from({ length: count * 3 }, (_, i) => Math.sin(i * 2.39996) * (1 + i % 17 / 17));
  let steps = 0;
  return (pulse: number): WorkloadMetrics => {
    let energy = 0;
    let center = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const angle = .007 + .012 * pulse;
      positions[i] = x * Math.cos(angle) - z * Math.sin(angle);
      positions[i + 2] = x * Math.sin(angle) + z * Math.cos(angle);
      positions[i + 1] = y * .998 + Math.sin(i + steps * .03) * (.002 + pulse * .006);
      energy += positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2;
      center += positions[i + 1];
    }
    steps++;
    const bins = Array.from({ length: 8 }, (_, bin) => rounded(positions[bin * 96 * 3 + 1]));
    return { particles: count, simulationSteps: steps, energy: rounded(energy / count), centroidY: rounded(center / count), positionsIntegrated: steps * count, bins };
  };
}
function fractalField() {
  let steps = 0;
  let totalIterations = 0;
  const field = new Uint8Array(960);
  return (pulse: number): WorkloadMetrics => {
    let escaped = 0;
    let checksum = 0;
    let iterations = 0;
    const zoom = 1.2 + Math.sin(steps * .015) * .15 + pulse * .1;
    for (let cell = 0; cell < 960; cell++) {
      const cx = ((cell % 40) / 40 - .5) * 3 / zoom - .5;
      const cy = (Math.floor(cell / 40) / 24 - .5) * 2 / zoom;
      let x = 0, y = 0, n = 0;
      while (x * x + y * y < 4 && n < 48) {
        const next = x * x - y * y + cx;
        y = 2 * x * y + cy;
        x = next;
        n++;
      }
      iterations += n;
      field[cell] = n;
      escaped += Number(n < 48);
      checksum = (Math.imul(checksum ^ n, 16777619) + cell) >>> 0;
    }
    steps++;
    totalIterations += iterations;
    const bins = Array.from({ length: 8 }, (_, bin) => field[12 * 40 + bin * 5]);
    return { cells: 960, fieldFrames: steps, iterations, totalIterations, escapedCells: escaped, fieldChecksum: checksum.toString(16).padStart(8, "0"), bins };
  };
}
function signalField() {
  let steps = 0;
  let samplesProcessed = 0;
  const samples = new Float64Array(512);
  return (pulse: number): WorkloadMetrics => {
    let square = 0, peak = 0, crossings = 0, previous = 0;
    for (let sample = 0; sample < 512; sample++) {
      const phase = (sample + steps * 512) / 512;
      const value = Math.sin(phase * Math.PI * 2 * 3.7) * .55 + Math.sin(phase * Math.PI * 2 * 11.3) * (.2 + pulse * .2);
      samples[sample] = value;
      square += value * value;
      peak = Math.max(peak, Math.abs(value));
      crossings += Number(value * previous < 0);
      previous = value;
    }
    steps++;
    samplesProcessed += 512;
    const bins = Array.from({ length: 8 }, (_, bin) => rounded(samples[32 + bin * 64]));
    return { samples: 512, signalFrames: steps, rms: rounded(Math.sqrt(square / 512)), peak: rounded(peak), zeroCrossings: crossings, samplesProcessed, bins };
  };
}
export function createWorkload(kind: WorkloadKind) {
  return ({ render: particleField, compute: fractalField, signals: signalField })[kind]();
}
