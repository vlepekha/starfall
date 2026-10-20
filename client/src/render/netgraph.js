/**
 * Netgraph: усе, що треба бачити під час мережевої гри.
 *
 * Без нього мережева частина — це чорна скринька: «щось лагає».
 * З ним одразу видно, що саме: виріс RTT, застарів знімок, роздулася
 * черга input чи поповзла поправка.
 */
const ROWS = [
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

export function createNetgraph(root) {
  root.innerHTML = `<div class="netgraph__title">netgraph <span id="netgraph-proto"></span></div>`;
  const protoEl = root.querySelector("#netgraph-proto");
  const fields = new Map();

  for (const row of ROWS) {
    const line = document.createElement("div");
    line.className = "netgraph__row";
    line.innerHTML = `<span class="netgraph__label"></span><span class="netgraph__value">—</span>`;
    line.querySelector(".netgraph__label").textContent = row.label;
    root.append(line);
    fields.set(row.key, line.querySelector(".netgraph__value"));
  }

  // Історія поправки: маленький спарклайн, по ньому найкраще видно
  // момент, коли симуляції розійшлися.
  const spark = document.createElement("canvas");
  spark.className = "netgraph__spark";
  spark.width = 240;
  spark.height = 40;
  root.append(spark);
  const ctx = spark.getContext("2d");
  const history = [];

  let lastPaint = 0;
  return {
    update(stats, timestamp) {
      if (timestamp - lastPaint < 100) return;
      lastPaint = timestamp;

      protoEl.textContent = stats.proto;
      for (const row of ROWS) {
        const value = stats[row.key] ?? 0;
        const field = fields.get(row.key);
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
