/**
 * Circuit Breaker Demo
 *
 * Simulates a flaky downstream service:
 *   0–15s  → 80% failure rate  (circuit trips after windowSize failures)
 *   15s+   → 0% failure rate   (probe succeeds, circuit closes)
 *
 * Run:  npx tsx examples/demo.ts
 * Needs: Redis on localhost:6379  (docker compose up -d)
 */

import { Queue } from 'bullmq';
import { CircuitBreakerWorker } from '../src';
import { CircuitState } from '../src/types';

const connection = { host: '127.0.0.1', port: 6379 };
const QUEUE = 'demo-circuit-breaker';

const startedAt = Date.now();
const elapsed = () => `[${((Date.now() - startedAt) / 1000).toFixed(1)}s]`;

// ── Flaky processor ────────────────────────────────────────────────────────────
const flakyPeriodMs = 15_000;

async function processor(job: { id?: string; data: unknown }) {
  const isFlaky = Date.now() - startedAt < flakyPeriodMs;
  const shouldFail = isFlaky && Math.random() < 0.8;

  if (shouldFail) {
    console.log(`${elapsed()} ❌  job ${job.id} FAILED (downstream down)`);
    throw new Error('Downstream unavailable');
  }

  console.log(`${elapsed()} ✅  job ${job.id} completed`);
  return { ok: true };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const queue = new Queue(QUEUE, { connection });

  const worker = new CircuitBreakerWorker(
    QUEUE,
    processor as never,
    { connection, concurrency: 2 },
    {
      failureThreshold: 0.6,  // trip at 60% failures
      windowSize: 5,           // evaluate last 5 jobs
      resetTimeout: 8_000,     // wait 8s before probing
      onStateChange: (from, to) =>
        console.log(`\n${elapsed()} ⚡ Circuit: ${from} → ${to}\n`),
    },
  );

  worker.on('stateChange', (_from: CircuitState, to: CircuitState) => {
    if (to === CircuitState.OPEN) {
      console.log(`${elapsed()} 🔴 Worker paused — jobs queuing up safely`);
    } else if (to === CircuitState.HALF_OPEN) {
      console.log(`${elapsed()} 🟡 Sending probe job...`);
    } else if (to === CircuitState.CLOSED) {
      console.log(`${elapsed()} 🟢 Circuit closed — resuming normal processing`);
    }
  });

  // Enqueue 40 jobs spaced 500ms apart
  console.log(`${elapsed()} 🚀 Starting demo — enqueuing jobs every 500ms\n`);
  for (let i = 1; i <= 40; i++) {
    await queue.add('task', { index: i }, { attempts: 1 });
    await new Promise((r) => setTimeout(r, 500));
  }

  // Print final metrics
  const m = worker.metrics;
  console.log('\n── Final metrics ──────────────────────────────');
  console.log(`  State:        ${m.state}`);
  console.log(`  Failure rate: ${(m.failureRate * 100).toFixed(0)}%`);
  console.log(`  Window:       ${m.windowFilled}/${m.windowSize}`);
  console.log('────────────────────────────────────────────────\n');

  await worker.close();
  await queue.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
