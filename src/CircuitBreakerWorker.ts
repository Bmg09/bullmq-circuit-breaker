import { EventEmitter } from 'events';
import { Job, Processor, Worker, WorkerOptions } from 'bullmq';
import { CircuitBreaker } from './CircuitBreaker';
import { CircuitBreakerOptions, CircuitMetrics, CircuitState } from './types';

/**
 * A BullMQ Worker wrapped with a Circuit Breaker.
 *
 * - CLOSED  → processes jobs normally
 * - OPEN    → worker is paused; jobs stay in the queue untouched
 * - HALF_OPEN → allows exactly one probe job; pauses again immediately after
 *
 * Emits: 'stateChange' (from: CircuitState, to: CircuitState)
 *
 * @example
 * const worker = new CircuitBreakerWorker(
 *   'email-queue',
 *   async (job) => sendEmail(job.data),
 *   { connection },
 *   { failureThreshold: 0.5, windowSize: 10, resetTimeout: 30_000 },
 * );
 *
 * worker.on('stateChange', (from, to) =>
 *   console.log(`Circuit: ${from} → ${to}`)
 * );
 */
export class CircuitBreakerWorker<
  DataType = unknown,
  ResultType = unknown,
> extends EventEmitter {
  private readonly worker: Worker<DataType, ResultType>;
  private readonly breaker: CircuitBreaker;

  /**
   * In HALF_OPEN, only one probe is allowed at a time.
   * This flag prevents concurrent probes when worker concurrency > 1.
   */
  private probing = false;

  constructor(
    queueName: string,
    processor: Processor<DataType, ResultType>,
    workerOpts: WorkerOptions,
    breakerOpts: CircuitBreakerOptions,
  ) {
    super();

    this.breaker = new CircuitBreaker(breakerOpts);

    const wrappedProcessor: Processor<DataType, ResultType> = async (
      job: Job<DataType, ResultType>,
      token?: string,
    ) => {
      const state = this.breaker.currentState;

      if (state === CircuitState.OPEN) {
        // Circuit is open — move the job back to delayed so it isn't lost.
        // It will be retried once the circuit closes.
        await job.moveToDelayed(Date.now() + breakerOpts.resetTimeout, token);
        return undefined as unknown as ResultType;
      }

      if (state === CircuitState.HALF_OPEN) {
        if (this.probing) {
          // Another probe is already in flight — delay this job briefly.
          await job.moveToDelayed(Date.now() + 2_000, token);
          return undefined as unknown as ResultType;
        }
        this.probing = true;
      }

      try {
        const result = await processor(job, token);
        this.breaker.record(true);
        this.probing = false;
        return result;
      } catch (err) {
        this.breaker.record(false);
        this.probing = false;
        throw err;
      }
    };

    this.worker = new Worker<DataType, ResultType>(
      queueName,
      wrappedProcessor,
      workerOpts,
    );

    // Sync BullMQ worker pause/resume with circuit state
    this.breaker.on('stateChange', async (from: CircuitState, to: CircuitState) => {
      this.emit('stateChange', from, to);

      if (to === CircuitState.OPEN) {
        await this.worker.pause();
      } else if (to === CircuitState.HALF_OPEN || to === CircuitState.CLOSED) {
        await this.worker.resume();
      }
    });
  }

  get state(): CircuitState {
    return this.breaker.currentState;
  }

  get metrics(): CircuitMetrics {
    return this.breaker.metrics;
  }

  async close(): Promise<void> {
    this.breaker.destroy();
    await this.worker.close();
  }
}
