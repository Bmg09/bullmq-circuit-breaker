import { EventEmitter } from 'events';
import { CircuitBreakerOptions, CircuitMetrics, CircuitState } from './types';
import { SlidingWindow } from './SlidingWindow';

/**
 * Pure state machine for the circuit breaker pattern.
 * No BullMQ dependency — can be tested in isolation.
 *
 * Emits: 'stateChange' (from: CircuitState, to: CircuitState)
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private window: SlidingWindow;
  private halfOpenTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: CircuitBreakerOptions) {
    super();
    this.window = new SlidingWindow(opts.windowSize);
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get metrics(): CircuitMetrics {
    return {
      failureRate: this.window.failureRate(),
      windowFilled: this.window.filled,
      windowSize: this.opts.windowSize,
      state: this.state,
    };
  }

  /**
   * Record a job outcome. Called by the worker wrapper after each job.
   */
  record(success: boolean): void {
    if (this.state === CircuitState.OPEN) return; // timer controls exit from OPEN

    if (this.state === CircuitState.HALF_OPEN) {
      // Probe result determines next state
      this.window.reset();
      this.transitionTo(success ? CircuitState.CLOSED : CircuitState.OPEN);
      return;
    }

    // CLOSED — track result and check threshold
    this.window.record(success);
    if (
      this.window.isFull() &&
      this.window.failureRate() >= this.opts.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private transitionTo(next: CircuitState): void {
    const prev = this.state;
    if (prev === next) return;

    this.state = next;
    this.opts.onStateChange?.(prev, next);
    this.emit('stateChange', prev, next);

    if (next === CircuitState.OPEN) {
      this.scheduleHalfOpen();
    }

    if (next === CircuitState.CLOSED) {
      this.clearTimer();
      this.window.reset();
    }
  }

  private scheduleHalfOpen(): void {
    this.clearTimer();
    this.halfOpenTimer = setTimeout(() => {
      if (this.state === CircuitState.OPEN) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }, this.opts.resetTimeout);
  }

  private clearTimer(): void {
    if (this.halfOpenTimer !== null) {
      clearTimeout(this.halfOpenTimer);
      this.halfOpenTimer = null;
    }
  }

  destroy(): void {
    this.clearTimer();
    this.removeAllListeners();
  }
}
