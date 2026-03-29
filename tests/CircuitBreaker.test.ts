import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CircuitBreaker } from '../src/CircuitBreaker';
import { CircuitState } from '../src/types';

function makeBreaker(overrides: Partial<Parameters<typeof CircuitBreaker>[0]> = {}) {
  return new CircuitBreaker({
    failureThreshold: 0.5,
    windowSize: 4,
    resetTimeout: 100, // short for tests
    ...overrides,
  });
}

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts CLOSED', () => {
    const cb = makeBreaker();
    expect(cb.currentState).toBe(CircuitState.CLOSED);
  });

  it('stays CLOSED when failure rate is below threshold', () => {
    const cb = makeBreaker({ failureThreshold: 0.6, windowSize: 4 });
    // 2 failures, 2 successes = 50% < 60%
    cb.record(false);
    cb.record(false);
    cb.record(true);
    cb.record(true);
    expect(cb.currentState).toBe(CircuitState.CLOSED);
  });

  it('does NOT trip before window is full', () => {
    const cb = makeBreaker({ failureThreshold: 0.5, windowSize: 4 });
    // 3 failures out of 3 — window not full yet (need 4)
    cb.record(false);
    cb.record(false);
    cb.record(false);
    expect(cb.currentState).toBe(CircuitState.CLOSED);
  });

  it('transitions CLOSED → OPEN when threshold is met', () => {
    const cb = makeBreaker({ failureThreshold: 0.5, windowSize: 4 });
    const changes: [CircuitState, CircuitState][] = [];
    cb.on('stateChange', (from, to) => changes.push([from, to]));

    // 4 failures → 100% failure rate ≥ 50%
    cb.record(false);
    cb.record(false);
    cb.record(false);
    cb.record(false);

    expect(cb.currentState).toBe(CircuitState.OPEN);
    expect(changes).toEqual([[CircuitState.CLOSED, CircuitState.OPEN]]);
  });

  it('calls onStateChange callback', () => {
    const onStateChange = vi.fn();
    const cb = makeBreaker({ onStateChange, windowSize: 2, failureThreshold: 0.5 });
    cb.record(false);
    cb.record(false);
    expect(onStateChange).toHaveBeenCalledWith(CircuitState.CLOSED, CircuitState.OPEN);
  });

  it('transitions OPEN → HALF_OPEN after resetTimeout', () => {
    const cb = makeBreaker({ windowSize: 2, failureThreshold: 0.5, resetTimeout: 1000 });
    cb.record(false);
    cb.record(false);
    expect(cb.currentState).toBe(CircuitState.OPEN);

    vi.advanceTimersByTime(1000);
    expect(cb.currentState).toBe(CircuitState.HALF_OPEN);
  });

  it('HALF_OPEN → CLOSED on successful probe', () => {
    const cb = makeBreaker({ windowSize: 2, failureThreshold: 0.5, resetTimeout: 500 });
    cb.record(false);
    cb.record(false);
    vi.advanceTimersByTime(500);
    expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

    cb.record(true); // probe succeeds
    expect(cb.currentState).toBe(CircuitState.CLOSED);
  });

  it('HALF_OPEN → OPEN on failed probe', () => {
    const cb = makeBreaker({ windowSize: 2, failureThreshold: 0.5, resetTimeout: 500 });
    cb.record(false);
    cb.record(false);
    vi.advanceTimersByTime(500);
    expect(cb.currentState).toBe(CircuitState.HALF_OPEN);

    cb.record(false); // probe fails
    expect(cb.currentState).toBe(CircuitState.OPEN);
  });

  it('window resets when circuit closes', () => {
    const cb = makeBreaker({ windowSize: 2, failureThreshold: 0.5, resetTimeout: 100 });
    cb.record(false);
    cb.record(false); // OPEN
    vi.advanceTimersByTime(100); // HALF_OPEN
    cb.record(true); // CLOSED — window resets

    expect(cb.metrics.windowFilled).toBe(0);
    expect(cb.metrics.failureRate).toBe(0);
  });

  it('records during OPEN state are ignored', () => {
    const cb = makeBreaker({ windowSize: 2, failureThreshold: 0.5, resetTimeout: 10000 });
    cb.record(false);
    cb.record(false); // OPEN
    cb.record(false); // should be ignored — circuit stays OPEN, no double-trigger
    expect(cb.currentState).toBe(CircuitState.OPEN);
  });

  it('exposes metrics', () => {
    const cb = makeBreaker({ windowSize: 4, failureThreshold: 0.5 });
    cb.record(false);
    cb.record(true);
    const m = cb.metrics;
    expect(m.windowFilled).toBe(2);
    expect(m.windowSize).toBe(4);
    expect(m.failureRate).toBe(0.5);
    expect(m.state).toBe(CircuitState.CLOSED);
  });
});
