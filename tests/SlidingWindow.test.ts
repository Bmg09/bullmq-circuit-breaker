import { describe, it, expect, beforeEach } from 'vitest';
import { SlidingWindow } from '../src/SlidingWindow';

describe('SlidingWindow', () => {
  let win: SlidingWindow;

  beforeEach(() => {
    win = new SlidingWindow(5);
  });

  it('throws on invalid size', () => {
    expect(() => new SlidingWindow(0)).toThrow(RangeError);
  });

  it('starts empty and unfull', () => {
    expect(win.isFull()).toBe(false);
    expect(win.failureRate()).toBe(0);
    expect(win.filled).toBe(0);
  });

  it('becomes full after windowSize records', () => {
    for (let i = 0; i < 5; i++) win.record(true);
    expect(win.isFull()).toBe(true);
    expect(win.filled).toBe(5);
  });

  it('evicts oldest record when full', () => {
    // Fill with 4 failures then 1 success — window full
    for (let i = 0; i < 4; i++) win.record(false);
    win.record(true);
    // failureRate = 4/5 = 0.8
    expect(win.failureRate()).toBeCloseTo(0.8);

    // Push another success — oldest failure evicted
    win.record(true);
    // window: [false, false, false, true, true] → 3/5 = 0.6
    expect(win.failureRate()).toBeCloseTo(0.6);
    expect(win.filled).toBe(5); // still full
  });

  it('computes 100% failure rate', () => {
    for (let i = 0; i < 5; i++) win.record(false);
    expect(win.failureRate()).toBe(1);
  });

  it('computes 0% failure rate', () => {
    for (let i = 0; i < 5; i++) win.record(true);
    expect(win.failureRate()).toBe(0);
  });

  it('resets correctly', () => {
    for (let i = 0; i < 5; i++) win.record(false);
    win.reset();
    expect(win.isFull()).toBe(false);
    expect(win.filled).toBe(0);
    expect(win.failureRate()).toBe(0);
  });
});
