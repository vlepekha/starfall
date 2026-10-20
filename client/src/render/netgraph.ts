/**
 * Netgraph: усе, що треба бачити під час мережевої гри.
 *
 * Без нього мережева частина — це чорна скринька: «щось лагає».
 * З ним одразу видно, що саме: виріс RTT, застарів знімок, роздулася
 * черга input чи поповзла поправка.
 */

import { el } from "../dom.ts";
import type { NetStats } from "../net/netcode.ts";

interface Row {
  key: keyof NetStats;
  label: string;
  format: (value: number) => string;
  warn: (value: number) => boolean;
}

const ROWS: Row[] = [
  { key: "rttMs", label: "RTT", format: (v) => `${Math.round(v)} мс`, warn: (v) => v > 150 },
  {
    key: "snapshotAgeMs",
    label: "вік знімка",
    format: (v) => `${Math.round(v)} мс`,
    warn: (v) => v > 120,
  },
  {
    key: "snapshotsPerSecond",
    label: "знімків/с",
    format: (v) => v.toFixed(1),
    warn: (v) => v < 25,
  },
  {
    key: "bytesInPerSecond",
    label: "вхід",
    format: (v) => `${(v / 1024).toFixed(1)} КБ/с`,
    warn: (v) => v > 40_000,
  },
  {
    key: "bytesOutPerSecond",
    label: "вихід",
    format: (v) => `${(v / 1024).toFixed(1)} КБ/с`,
    warn: () => false,
  },
  {
    key: "pendingInputs",
    label: "черга input",
    format: (v) => String(v),
    warn: (v) => v > 8,
  },
  {
    key: "correctionUnits",
    label: "поправка",
    format: (v) => `${v.toFixed(1)} од.`,
    warn: (v) => v > 4,
  },
  { key: "entities", label: "сутностей", format: (v) => String(v), warn: () => false },
];

export function createNetgraph(root: HTMLElement) {
  root.innerHTML = `<div class="netgraph__title">netgraph <span id="netgraph-proto"></span></div>`;
  const protoEl = el("#netgraph-proto", root);
  const fields = new Map<string, HTMLElement>();

  for (const row of ROWS) {
    const line = document.createElement("div");
    line.className = "netgraph__row";
    line.innerHTML = `<span class="netgraph__label"></span><span class="netgraph__value">—</span>`;
    el(".netgraph__label", line).textContent = row.label;
    root.append(line);
    fields.set(row.key, el(".netgraph__value", line));
  }

  // Історія поправки: маленький спарклайн, по ньому найкраще видно
  // момент, коли симуляції розійшлися.
  const spark = document.createElement("canvas");
  spark.className = "netgraph__spark";
  spark.width = 240;
  spark.height = 40;
  root.append(spark);
  const ctx = spark.getContext("2d");
  if (!ctx) throw new Error("не вдалося отримати контекст 2d");
  const history: number[] = [];

  let lastPaint = 0;
  return {
    update(stats: NetStats, timestamp: number): void {
      if (timestamp - lastPaint < 100) return;
      lastPaint = timestamp;

      protoEl.textContent = stats.proto;
      for (const row of ROWS) {
        const raw = stats[row.key];
        const value = typeof raw === "number" ? raw : 0;
        const field = fields.get(row.key);
        if (!field) continue;
        field.textContent = row.format(value);
        field.classList.toggle("is-warn", row.warn(value));
      }

      history.push(stats.correctionUnits ?? 0);
      while (history.length > spark.width / 3) history.shift();

      ctx.clearRect(0, 0, spark.width, spark.height);
      const max = Math.max(2, ...history);
      ctx.strokeStyle = "#7ee0ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      history.forEach((value, i) => {
        const x = (i / (spark.width / 3 - 1)) * spark.width;
        const y = spark.height - (value / max) * (spark.height - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = "#5d719c";
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.fillText(`поправка, макс ${max.toFixed(1)}`, 4, 10);
    },
  };
}
