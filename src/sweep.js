import { mkdirSync, writeFileSync } from "node:fs";
import { runTrials } from "./simulator.js";

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = raw.split("=")[1];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBatchList() {
  const raw = process.argv.find((arg) => arg.startsWith("--batches="));
  if (!raw) return [2, 4, 6, 8, 10, 12];

  const list = raw
    .split("=")[1]
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((a, b) => a - b);

  return list.length > 0 ? list : [2, 4, 6, 8, 10, 12];
}

function fmt(num, digits = 2) {
  return num.toFixed(digits);
}

function toCsv(rows) {
  const header = [
    "batch_size",
    "wall_clock_hours",
    "runner_minutes",
    "suite_runs",
    "throughput_pr_per_hour",
    "wall_clock_reduction_pct",
    "throughput_gain_pct"
  ].join(",");

  const body = rows
    .map((row) => [
      row.batch,
      row.wallClockHours,
      row.runnerMinutes,
      row.suiteRuns,
      row.throughput,
      row.wallClockReductionPct,
      row.throughputGainPct
    ].join(","))
    .join("\n");

  return `${header}\n${body}\n`;
}

function toMarkdownReport(config, baseline, rows) {
  const xAxis = rows.map((row) => row.batch).join(", ");
  const maxWallClock = Math.max(...rows.map((row) => row.wallClockHours), baseline.wallClockHours);
  const yMax = Math.ceil(maxWallClock * 1.1);

  const tableHeader = "| Batch | Wall Clock (h) | Runner Minutes | Suite Runs | PR/hour | Wall Clock Reduction | Throughput Gain |";
  const tableSeparator = "|---:|---:|---:|---:|---:|---:|---:|";
  const tableRows = rows
    .map((row) => `| ${row.batch} | ${fmt(row.wallClockHours)} | ${fmt(row.runnerMinutes)} | ${fmt(row.suiteRuns, 1)} | ${fmt(row.throughput)} | ${fmt(row.wallClockReductionPct)}% | ${fmt(row.throughputGainPct)}% |`)
    .join("\n");

  const points = rows.map((row) => `[${row.batch}, ${fmt(row.wallClockHours)}]`).join(", ");

  return [
    "# Merge Queue Sweep Report",
    "",
    "## Scenario",
    `- PRs: ${config.prs}`,
    `- Tests per PR: ${config.tests}`,
    `- Trials: ${config.trials}`,
    `- CI runners: ${config.runners}`,
    "",
    "## Baseline (Without Merge Queue)",
    `- Wall Clock: ${fmt(baseline.wallClockHours)} h`,
    `- Runner Minutes: ${fmt(baseline.totalRunnerMinutes)}`,
    `- Suite Runs: ${fmt(baseline.suiteRuns, 1)}`,
    `- Throughput: ${fmt(baseline.throughputPrPerHour)} PR/hour`,
    "",
    "## Sweep Results",
    tableHeader,
    tableSeparator,
    tableRows,
    "",
    "## Mermaid Chart (Wall Clock vs Batch Size)",
    "```mermaid",
    "xychart-beta",
    '  title "Merge Queue Batch Size Impact"',
    `  x-axis "Batch Size" [${xAxis}]`,
    `  y-axis "Wall Clock Hours" 0 --> ${yMax}`,
    `  line [${rows.map((row) => fmt(row.wallClockHours)).join(", ")}]`,
    "```",
    "",
    "## Data Points",
    `- ${points}`,
    ""
  ].join("\n");
}

const config = {
  prs: parseArg("prs", 100),
  tests: parseArg("tests", 1200),
  trials: parseArg("trials", 50),
  runners: parseArg("runners", 12),
  flake: parseArg("flake", 0.002),
  riskyFail: parseArg("risky", 0.35),
  minTestSec: parseArg("min", 0.25),
  maxTestSec: parseArg("max", 1.8),
  rebasePenaltySec: parseArg("rebase", 75),
  queueOverheadSec: parseArg("qoverhead", 35),
  seed: parseArg("seed", 42)
};

const batches = parseBatchList();

const baselineResult = runTrials({ ...config, batch: 1 });
const baseline = baselineResult.noQueue;

const rows = batches.map((batch, index) => {
  const result = runTrials({ ...config, batch, seed: config.seed + 1000 + index });
  const mq = result.mergeQueue;

  return {
    batch,
    wallClockHours: mq.wallClockHours,
    runnerMinutes: mq.totalRunnerMinutes,
    suiteRuns: mq.suiteRuns,
    throughput: mq.throughputPrPerHour,
    wallClockReductionPct: ((baseline.wallClockHours - mq.wallClockHours) / baseline.wallClockHours) * 100,
    throughputGainPct: ((mq.throughputPrPerHour - baseline.throughputPrPerHour) / baseline.throughputPrPerHour) * 100
  };
});

mkdirSync("results", { recursive: true });
writeFileSync("results/sweep.csv", toCsv(rows), "utf8");
writeFileSync("results/sweep-report.md", toMarkdownReport(config, baseline, rows), "utf8");

console.log("Generated files:");
console.log("  results/sweep.csv");
console.log("  results/sweep-report.md");
console.log("");
console.table(
  rows.map((row) => ({
    Batch: row.batch,
    "Wall Clock (h)": fmt(row.wallClockHours),
    "PR/hour": fmt(row.throughput),
    "Throughput Gain %": fmt(row.throughputGainPct),
    "Wall Clock Reduction %": fmt(row.wallClockReductionPct)
  }))
);
