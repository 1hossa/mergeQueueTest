import { setTimeout as sleep } from "node:timers/promises";

function parseArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;

  const value = raw.split("=")[1];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createRng(seed) {
  let state = seed >>> 0;

  return function rand() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function sumDurations(testCount, minMs, maxMs, seed) {
  const rand = createRng(seed);
  let totalMs = 0;

  for (let i = 0; i < testCount; i += 1) {
    totalMs += minMs + rand() * (maxMs - minMs);
  }

  return totalMs;
}

const tests = parseArg("tests", 1400);
const shardIndex = parseArg("shard", 1);
const shardTotal = parseArg("shards", 8);
const minMs = parseArg("min", 150);
const maxMs = parseArg("max", 1900);
const compression = parseArg("compression", 220);
const setupOverheadMs = parseArg("overhead", 4500);
const seed = parseArg("seed", 42) + shardIndex * 17;

const testsInShard = Math.ceil(tests / shardTotal);
const logicalMs = sumDurations(testsInShard, minMs, maxMs, seed);
const simulatedMs = Math.max(800, Math.round(logicalMs / compression + setupOverheadMs));

console.log(`Shard ${shardIndex}/${shardTotal}`);
console.log(`Tests in shard: ${testsInShard}`);
console.log(`Logical test time: ${(logicalMs / 1000 / 60).toFixed(2)} min`);
console.log(`Simulated real time: ${(simulatedMs / 1000).toFixed(2)} sec`);

await sleep(simulatedMs);

console.log("Shard finished successfully.");
