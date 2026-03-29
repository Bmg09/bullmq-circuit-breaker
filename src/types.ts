export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /**
   * Failure rate (0–1) that trips the circuit.
   * e.g. 0.5 means trip when ≥50% of the last `windowSize` jobs failed.
   */
  failureThreshold: number;

  /**
   * Number of recent job results to evaluate the failure rate against.
   * The circuit only trips once this many jobs have been processed.
   */
  windowSize: number;

  /**
   * Milliseconds to wait in OPEN state before probing (HALF_OPEN).
   */
  resetTimeout: number;

  /**
   * Optional callback fired on every state transition.
   */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export interface CircuitMetrics {
  failureRate: number;
  windowFilled: number;
  windowSize: number;
  state: CircuitState;
}
