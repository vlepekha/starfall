/**
 * Експеримент лаби 7: чи варто переносити розбір знімків у Web Worker.
 *
 * Міряємо той самий обсяг роботи двома способами:
 *   1) розбір у головному потоці;
 *   2) розбір у воркері з передачею буфера туди й відповіді назад.
 *
 * Рішення приймається за числами, а не за відчуттям «воркер — це швидко».
 */
import { entityId, millis, seq, tick, Vector2 } from "@starfall/shared";
import { decodeSnapshot, encodeSnapshot } from "@starfall/shared/protocol";

const ROUNDS = 300;

function makeFrame(count: number): ArrayBuffer {
  return encodeSnapshot({
    tick: tick(1),
    serverTimeMs: millis(1),
    ackSeq: seq(1),
    rngState: 1,
    youId: entityId(1),
    entities: Array.from({ length: count }, (_, i) => ({
      id: entityId(i + 1),
      kind: "ship" as const,
      pos: new Vector2(i * 3, i * 5),
      vel: new Vector2(1, 2),
      angle: 0.5,
      radius: 14,
      hp: 3,
      thrusting: true,
      hunting: false,
      homingEnabled: false,
      invulnerable: false,
    })),
  });
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return +(sorted[index] ?? 0).toFixed(3);
}

function measureMain(frame: ArrayBuffer): number[] {
  const samples: number[] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const copy = frame.slice(0);
    const t0 = performance.now();
    decodeSnapshot(copy);
    samples.push(performance.now() - t0);
  }
  return samples;
}

function measureWorker(frame: ArrayBuffer): Promise<number[]> {
  const worker = new Worker(new URL("./decode.worker.ts", import.meta.url), { type: "module" });
  const samples: number[] = [];

  return new Promise((resolve) => {
    let id = 0;
    let startedAt = 0;

    const next = (): void => {
      if (id >= ROUNDS) {
        worker.terminate();
        resolve(samples);
        return;
      }
      id += 1;
      // Буфер передаємо, а не копіюємо: інакше міряли б structuredClone.
      const copy = frame.slice(0);
      startedAt = performance.now();
      worker.postMessage({ id, bytes: copy }, [copy]);
    };

    worker.onmessage = () => {
      samples.push(performance.now() - startedAt);
      next();
    };

    next();
  });
}

export async function runWorkerExperiment(entities: number): Promise<{
  entities: number;
  rounds: number;
  mainMs: { p50: number; p95: number; total: number };
  workerMs: { p50: number; p95: number; total: number };
  verdict: string;
}> {
  const frame = makeFrame(entities);
  const main = measureMain(frame);
  const worker = await measureWorker(frame);

  const sum = (values: number[]): number => +values.reduce((a, b) => a + b, 0).toFixed(2);
  const mainP50 = percentile(main, 50);
  const workerP50 = percentile(worker, 50);

  return {
    entities,
    rounds: ROUNDS,
    mainMs: { p50: mainP50, p95: percentile(main, 95), total: sum(main) },
    workerMs: { p50: workerP50, p95: percentile(worker, 95), total: sum(worker) },
    verdict:
      workerP50 < mainP50
        ? "воркер швидший — переносимо"
        : "воркер повільніший — лишаємо в головному потоці",
  };
}
