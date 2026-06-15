function createRng(seed) {
  let state = seed >>> 0;

  return function rand() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function generatePullRequests({ count, testsPerPr, minTestSec, maxTestSec, seed }) {
  const rand = createRng(seed);
  const prs = [];

  for (let i = 0; i < count; i += 1) {
    let suiteDurationSec = 0;
    for (let t = 0; t < testsPerPr; t += 1) {
      const duration = minTestSec + rand() * (maxTestSec - minTestSec);
      suiteDurationSec += duration;
    }

    prs.push({
      id: i + 1,
      suiteDurationSec,
      // Roughly every N-th PR contains a risky change that may fail integration checks.
      hasRiskyChange: rand() < 0.08
    });
  }

  return prs;
}

function calcWallClockSec(totalRunnerSec, runners) {
  return totalRunnerSec / runners;
}

function simulateWithoutMergeQueue(prs, options) {
  const {
    flakySuiteFailureRate,
    manualRebasePenaltySec,
    runners,
    retryOnFlake
  } = options;

  let totalSuiteRuns = 0;
  let totalRunnerSec = 0;
  let totalRebaseSec = 0;

  for (let idx = 0; idx < prs.length; idx += 1) {
    const pr = prs[idx];

    // Every prior merge invalidates this PR's green build, so the suite must be re-run.
    const invalidations = idx;
    const requiredRuns = 1 + invalidations;

    for (let run = 0; run < requiredRuns; run += 1) {
      totalSuiteRuns += 1;
      totalRunnerSec += pr.suiteDurationSec;

      const flakyFail = Math.random() < flakySuiteFailureRate;
      if (flakyFail && retryOnFlake) {
        totalSuiteRuns += 1;
        totalRunnerSec += pr.suiteDurationSec;
      }
    }

    totalRebaseSec += invalidations * manualRebasePenaltySec;
  }

  const wallClockSec = calcWallClockSec(totalRunnerSec + totalRebaseSec, runners);

  return {
    flow: "without_merge_queue",
    suiteRuns: totalSuiteRuns,
    totalRunnerMinutes: totalRunnerSec / 60,
    rebaseMinutes: totalRebaseSec / 60,
    wallClockHours: wallClockSec / 3600,
    throughputPrPerHour: prs.length / (wallClockSec / 3600)
  };
}

function simulateWithMergeQueue(prs, options) {
  const {
    batchSize,
    flakySuiteFailureRate,
    riskyChangeFailureRate,
    queueOverheadSec,
    runners,
    retryOnFlake
  } = options;

  let totalSuiteRuns = 0;
  let totalRunnerSec = 0;
  let queueOpsSec = 0;

  for (let start = 0; start < prs.length; start += batchSize) {
    const batch = prs.slice(start, start + batchSize);
    const batchSuiteSec = batch.reduce((sum, pr) => sum + pr.suiteDurationSec, 0);

    totalSuiteRuns += 1;
    totalRunnerSec += batchSuiteSec;
    queueOpsSec += queueOverheadSec;

    const flakyFail = Math.random() < flakySuiteFailureRate;
    const riskyFail = batch.some((pr) => pr.hasRiskyChange) && Math.random() < riskyChangeFailureRate;

    if (flakyFail && retryOnFlake) {
      totalSuiteRuns += 1;
      totalRunnerSec += batchSuiteSec;
    }

    // If a batch fails due to risky change, queue isolates PRs and validates each once.
    if (riskyFail) {
      for (const pr of batch) {
        totalSuiteRuns += 1;
        totalRunnerSec += pr.suiteDurationSec;
      }
    }
  }

  const wallClockSec = calcWallClockSec(totalRunnerSec + queueOpsSec, runners);

  return {
    flow: "with_merge_queue",
    suiteRuns: totalSuiteRuns,
    totalRunnerMinutes: totalRunnerSec / 60,
    rebaseMinutes: 0,
    wallClockHours: wallClockSec / 3600,
    throughputPrPerHour: prs.length / (wallClockSec / 3600)
  };
}

export function runSingleSimulation(config) {
  const prs = generatePullRequests({
    count: config.prs,
    testsPerPr: config.tests,
    minTestSec: config.minTestSec,
    maxTestSec: config.maxTestSec,
    seed: config.seed
  });

  const noQueue = simulateWithoutMergeQueue(prs, {
    flakySuiteFailureRate: config.flake,
    manualRebasePenaltySec: config.rebasePenaltySec,
    runners: config.runners,
    retryOnFlake: true
  });

  const mergeQueue = simulateWithMergeQueue(prs, {
    batchSize: config.batch,
    flakySuiteFailureRate: config.flake,
    riskyChangeFailureRate: config.riskyFail,
    queueOverheadSec: config.queueOverheadSec,
    runners: config.runners,
    retryOnFlake: true
  });

  return { noQueue, mergeQueue };
}

export function runTrials(config) {
  let noQueueAcc = {
    suiteRuns: 0,
    totalRunnerMinutes: 0,
    rebaseMinutes: 0,
    wallClockHours: 0,
    throughputPrPerHour: 0
  };

  let mergeQueueAcc = {
    suiteRuns: 0,
    totalRunnerMinutes: 0,
    rebaseMinutes: 0,
    wallClockHours: 0,
    throughputPrPerHour: 0
  };

  for (let i = 0; i < config.trials; i += 1) {
    const result = runSingleSimulation({ ...config, seed: config.seed + i });

    noQueueAcc = {
      suiteRuns: noQueueAcc.suiteRuns + result.noQueue.suiteRuns,
      totalRunnerMinutes: noQueueAcc.totalRunnerMinutes + result.noQueue.totalRunnerMinutes,
      rebaseMinutes: noQueueAcc.rebaseMinutes + result.noQueue.rebaseMinutes,
      wallClockHours: noQueueAcc.wallClockHours + result.noQueue.wallClockHours,
      throughputPrPerHour: noQueueAcc.throughputPrPerHour + result.noQueue.throughputPrPerHour
    };

    mergeQueueAcc = {
      suiteRuns: mergeQueueAcc.suiteRuns + result.mergeQueue.suiteRuns,
      totalRunnerMinutes: mergeQueueAcc.totalRunnerMinutes + result.mergeQueue.totalRunnerMinutes,
      rebaseMinutes: mergeQueueAcc.rebaseMinutes + result.mergeQueue.rebaseMinutes,
      wallClockHours: mergeQueueAcc.wallClockHours + result.mergeQueue.wallClockHours,
      throughputPrPerHour: mergeQueueAcc.throughputPrPerHour + result.mergeQueue.throughputPrPerHour
    };
  }

  const avg = (acc) => ({
    suiteRuns: acc.suiteRuns / config.trials,
    totalRunnerMinutes: acc.totalRunnerMinutes / config.trials,
    rebaseMinutes: acc.rebaseMinutes / config.trials,
    wallClockHours: acc.wallClockHours / config.trials,
    throughputPrPerHour: acc.throughputPrPerHour / config.trials
  });

  const noQueue = avg(noQueueAcc);
  const mergeQueue = avg(mergeQueueAcc);

  const suiteRunReductionPct = ((noQueue.suiteRuns - mergeQueue.suiteRuns) / noQueue.suiteRuns) * 100;
  const wallClockReductionPct = ((noQueue.wallClockHours - mergeQueue.wallClockHours) / noQueue.wallClockHours) * 100;
  const throughputGainPct = ((mergeQueue.throughputPrPerHour - noQueue.throughputPrPerHour) / noQueue.throughputPrPerHour) * 100;

  return {
    noQueue,
    mergeQueue,
    delta: {
      suiteRunReductionPct,
      wallClockReductionPct,
      throughputGainPct
    }
  };
}
