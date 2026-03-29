/**
 * Fixed-size circular buffer tracking the last N job outcomes.
 * true = success, false = failure.
 */
export class SlidingWindow {
  private results: boolean[] = [];
  private readonly size: number;

  constructor(size: number) {
    if (size < 1) throw new RangeError('windowSize must be ≥ 1');
    this.size = size;
  }

  record(success: boolean): void {
    this.results.push(success);
    if (this.results.length > this.size) {
      this.results.shift();
    }
  }

  failureRate(): number {
    if (this.results.length === 0) return 0;
    const failures = this.results.filter((r) => !r).length;
    return failures / this.results.length;
  }

  isFull(): boolean {
    return this.results.length >= this.size;
  }

  reset(): void {
    this.results = [];
  }

  get filled(): number {
    return this.results.length;
  }
}
