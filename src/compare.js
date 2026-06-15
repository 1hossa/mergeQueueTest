import { runTrials } from "./simulator.js";

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;

  const value = raw.split("=")[1];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fmt(num, digits = 2) {
  return num.toFixed(digits);
}

function printReport(config, result) {
  console.log("=== Merge Queue Performance Lab ===");
  console.log("Scenario:");
  console.log(`  PRs:                 ${config.prs}`);
  console.log(`  Tests per PR:        ${config.tests}`);
  console.log(`  Trials:              ${config.trials}`);
  console.log(`  CI runners:          ${config.runners}`);
  console.log(`  Merge Queue batch:   ${config.batch}`);
  console.log("");

  console.log("Average metrics:");
  console.table([
    {
      Flow: "Without Merge Queue",
      "Suite runs": fmt(result.noQueue.suiteRuns, 1),
      "Runner minutes": fmt(result.noQueue.totalRunnerMinutes),
      "Rebase minutes": fmt(result.noQueue.rebaseMinutes),
      "Wall clock hours": fmt(result.noQueue.wallClockHours),
      "PR/hour": fmt(result.noQueue.throughputPrPerHour)
    },
    {
      Flow: "With Merge Queue",
      "Suite runs": fmt(result.mergeQueue.suiteRuns, 1),
      "Runner minutes": fmt(result.mergeQueue.totalRunnerMinutes),
      "Rebase minutes": fmt(result.mergeQueue.rebaseMinutes),
      "Wall clock hours": fmt(result.mergeQueue.wallClockHours),
      "PR/hour": fmt(result.mergeQueue.throughputPrPerHour)
    }
  ]);

  console.log("Key improvements (Merge Queue vs baseline):");
  console.log(`  Suite run reduction: ${fmt(result.delta.suiteRunReductionPct)}%`);
  console.log(`  Wall clock reduction:${fmt(result.delta.wallClockReductionPct)}%`);
  console.log(`  Throughput gain:     ${fmt(result.delta.throughputGainPct)}%`);
}

const config = {
  prs: parseArg("prs", 60),
  tests: parseArg("tests", 900),
  batch: parseArg("batch", 6),
  trials: parseArg("trials", 30),
  runners: parseArg("runners", 10),
  flake: parseArg("flake", 0.0015),
  riskyFail: parseArg("risky", 0.3),
  minTestSec: parseArg("min", 0.25),
  maxTestSec: parseArg("max", 1.8),
  rebasePenaltySec: parseArg("rebase", 75),
  queueOverheadSec: parseArg("qoverhead", 35),
  seed: parseArg("seed", 42)
};

const result = runTrials(config);
printReport(config, result);
