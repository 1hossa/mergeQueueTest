import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;

  const value = raw.split("=")[1];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value || fallback;
}

function fmt(num, digits = 2) {
  return Number.isFinite(num) ? num.toFixed(digits) : "n/a";
}

function toCsv(rows) {
  const header = [
    "flow",
    "runs",
    "success_pct",
    "mean_duration_min",
    "p50_duration_min",
    "p95_duration_min",
    "mean_queue_wait_min",
    "p95_queue_wait_min"
  ].join(",");

  const body = rows
    .map((row) => [
      row.Flow,
      row.Runs,
      row["Success %"],
      row["Mean duration (min)"],
      row["P50 duration (min)"],
      row["P95 duration (min)"],
      row["Mean queue wait (min)"],
      row["P95 queue wait (min)"]
    ].join(","))
    .join("\n");

  return `${header}\n${body}\n`;
}

function toMarkdown({ repo, days, baselineBranch, queueBranch, rows, durationReduction }) {
  const lines = [
    "# GitHub Merge Queue Metrics",
    "",
    "## Context",
    `- Repository: ${repo}`,
    `- Window: last ${days} days`,
    `- Baseline branch: ${baselineBranch}`,
    `- Queue branch: ${queueBranch}`,
    "",
    "## Summary Table",
    "| Flow | Runs | Success % | Mean duration (min) | P50 duration (min) | P95 duration (min) | Mean queue wait (min) | P95 queue wait (min) |",
    "|---|---:|---:|---:|---:|---:|---:|---:|"
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.Flow} | ${row.Runs} | ${row["Success %"]} | ${row["Mean duration (min)"]} | ${row["P50 duration (min)"]} | ${row["P95 duration (min)"]} | ${row["Mean queue wait (min)"]} | ${row["P95 queue wait (min)"]} |`
    );
  }

  lines.push("");
  if (Number.isFinite(durationReduction)) {
    lines.push(`- Mean duration change (merge_group vs baseline): ${fmt(durationReduction)}%`);
  }
  lines.push("");

  return lines.join("\n");
}

function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

async function fetchRuns({ repo, branch, event, token }) {
  const runs = [];
  let page = 1;

  while (page <= 5) {
    const url = new URL(`https://api.github.com/repos/${repo}/actions/runs`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("branch", branch);
    url.searchParams.set("event", event);

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    runs.push(...data.workflow_runs);

    if (!data.workflow_runs || data.workflow_runs.length < 100) break;
    page += 1;
  }

  return runs;
}

function summarizeRuns(runs, days) {
  const minDate = Date.now() - days * 24 * 60 * 60 * 1000;
  const filtered = runs.filter((run) => {
    if (!run.run_started_at || !run.updated_at || !run.created_at) return false;
    const created = new Date(run.created_at).getTime();
    return Number.isFinite(created) && created >= minDate;
  });

  const durationsMin = filtered
    .map((run) => (new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) / 60000)
    .filter((value) => Number.isFinite(value) && value >= 0);

  const queueMin = filtered
    .map((run) => (new Date(run.run_started_at).getTime() - new Date(run.created_at).getTime()) / 60000)
    .filter((value) => Number.isFinite(value) && value >= 0);

  const successCount = filtered.filter((run) => run.conclusion === "success").length;

  const meanDuration = durationsMin.reduce((sum, item) => sum + item, 0) / (durationsMin.length || 1);
  const meanQueue = queueMin.reduce((sum, item) => sum + item, 0) / (queueMin.length || 1);

  return {
    totalRuns: filtered.length,
    successRate: filtered.length > 0 ? (successCount / filtered.length) * 100 : NaN,
    meanDuration,
    p50Duration: percentile(durationsMin, 50),
    p95Duration: percentile(durationsMin, 95),
    meanQueue,
    p95Queue: percentile(queueMin, 95)
  };
}

const repo = parseArg("repo", process.env.GITHUB_REPOSITORY || "");
const baselineBranch = parseArg("baseline", "main-no-mq");
const queueBranch = parseArg("queue", "main");
const days = Number(parseArg("days", 14));
const outdir = parseArg("outdir", "results");
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!repo) {
  console.error("Missing --repo=owner/name or GITHUB_REPOSITORY env var.");
  process.exit(1);
}

if (!token) {
  console.error("Missing GH_TOKEN or GITHUB_TOKEN with actions:read permission.");
  process.exit(1);
}

const baselineRuns = await fetchRuns({ repo, branch: baselineBranch, event: "pull_request", token });
const mergeQueuePrRuns = await fetchRuns({ repo, branch: queueBranch, event: "pull_request", token });
const mergeQueueGroupRuns = await fetchRuns({ repo, branch: queueBranch, event: "merge_group", token });

const baseline = summarizeRuns(baselineRuns, days);
const queuePr = summarizeRuns(mergeQueuePrRuns, days);
const queueGroup = summarizeRuns(mergeQueueGroupRuns, days);

const rows = [
  {
    Flow: "No Merge Queue (PR checks)",
    "Runs": baseline.totalRuns,
    "Success %": fmt(baseline.successRate),
    "Mean duration (min)": fmt(baseline.meanDuration),
    "P50 duration (min)": fmt(baseline.p50Duration),
    "P95 duration (min)": fmt(baseline.p95Duration),
    "Mean queue wait (min)": fmt(baseline.meanQueue),
    "P95 queue wait (min)": fmt(baseline.p95Queue)
  },
  {
    Flow: "Merge Queue branch (PR checks)",
    "Runs": queuePr.totalRuns,
    "Success %": fmt(queuePr.successRate),
    "Mean duration (min)": fmt(queuePr.meanDuration),
    "P50 duration (min)": fmt(queuePr.p50Duration),
    "P95 duration (min)": fmt(queuePr.p95Duration),
    "Mean queue wait (min)": fmt(queuePr.meanQueue),
    "P95 queue wait (min)": fmt(queuePr.p95Queue)
  },
  {
    Flow: "Merge Queue (merge_group checks)",
    "Runs": queueGroup.totalRuns,
    "Success %": fmt(queueGroup.successRate),
    "Mean duration (min)": fmt(queueGroup.meanDuration),
    "P50 duration (min)": fmt(queueGroup.p50Duration),
    "P95 duration (min)": fmt(queueGroup.p95Duration),
    "Mean queue wait (min)": fmt(queueGroup.meanQueue),
    "P95 queue wait (min)": fmt(queueGroup.p95Queue)
  }
];

console.log(`Repository: ${repo}`);
console.log(`Window: last ${days} days`);
console.log("");
console.table(rows);

let durationReduction = NaN;

if (Number.isFinite(baseline.meanDuration) && Number.isFinite(queueGroup.meanDuration)) {
  durationReduction = ((baseline.meanDuration - queueGroup.meanDuration) / baseline.meanDuration) * 100;
  console.log("");
  console.log(`Mean duration change (merge_group vs baseline): ${fmt(durationReduction)}%`);
}

mkdirSync(outdir, { recursive: true });
const csvPath = join(outdir, "github-metrics.csv");
const mdPath = join(outdir, "github-metrics-report.md");

writeFileSync(csvPath, toCsv(rows), "utf8");
writeFileSync(
  mdPath,
  toMarkdown({ repo, days, baselineBranch, queueBranch, rows, durationReduction }),
  "utf8"
);

console.log("");
console.log("Saved reports:");
console.log(`  ${csvPath}`);
console.log(`  ${mdPath}`);
