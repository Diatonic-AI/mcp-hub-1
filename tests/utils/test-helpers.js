/**
 * Test utilities for proper async cleanup
 */

import { vi } from 'vitest';

/**
 * Tracks active timers and intervals for cleanup
 */
class TimerTracker {
  constructor() {
    this.timers = new Set();
    this.intervals = new Set();
    this.originalSetTimeout = global.setTimeout;
    this.originalSetInterval = global.setInterval;
    this.originalClearTimeout = global.clearTimeout;
    this.originalClearInterval = global.clearInterval;
  }

  start() {
    // Override setTimeout
    global.setTimeout = (fn, delay, ...args) => {
      const timer = this.originalSetTimeout(fn, delay, ...args);
      this.timers.add(timer);
      return timer;
    };

    // Override setInterval
    global.setInterval = (fn, delay, ...args) => {
      const interval = this.originalSetInterval(fn, delay, ...args);
      this.intervals.add(interval);
      return interval;
    };

    // Override clearTimeout
    global.clearTimeout = (timer) => {
      this.timers.delete(timer);
      return this.originalClearTimeout(timer);
    };

    // Override clearInterval
    global.clearInterval = (interval) => {
      this.intervals.delete(interval);
      return this.originalClearInterval(interval);
    };
  }

  cleanup() {
    // Clear all active timers
    for (const timer of this.timers) {
      this.originalClearTimeout(timer);
    }
    this.timers.clear();

    // Clear all active intervals
    for (const interval of this.intervals) {
      this.originalClearInterval(interval);
    }
    this.intervals.clear();

    // Restore original functions
    global.setTimeout = this.originalSetTimeout;
    global.setInterval = this.originalSetInterval;
    global.clearTimeout = this.originalClearTimeout;
    global.clearInterval = this.originalClearInterval;
  }
}

/**
 * Creates a test environment with proper cleanup
 */
export function createTestEnvironment() {
  const timerTracker = new TimerTracker();
  const activePromises = new Set();

  return {
    setup() {
      timerTracker.start();
    },

    async cleanup() {
      // Wait for all active promises
      if (activePromises.size > 0) {
        await Promise.allSettled(Array.from(activePromises));
      }
      activePromises.clear();

      // Clean up timers
      timerTracker.cleanup();

      // Clear all mocks
      vi.clearAllMocks();

      // Additional cleanup
      await new Promise(resolve => setImmediate(resolve));
    },

    trackPromise(promise) {
      activePromises.add(promise);
      promise.finally(() => activePromises.delete(promise));
      return promise;
    }
  };
}

/**
 * Wait for all pending promises and timers
 */
export async function waitForPendingAsync(timeout = 100) {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, timeout));
}

/**
 * Create a mock logger that doesn't throw in tests
 */
export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    setSseManager: vi.fn(),
    recordTelemetry: vi.fn()
  };
}

/**
 * Safely cleanup a resource with error handling
 */
export async function safeCleanup(resource, cleanupMethod = 'cleanup') {
  if (!resource) return;
  
  try {
    if (typeof resource[cleanupMethod] === 'function') {
      const result = resource[cleanupMethod]();
      if (result && typeof result.then === 'function') {
        await result;
      }
    }
  } catch (error) {
    // Ignore cleanup errors in tests
    console.warn(`Cleanup error ignored: ${error.message}`);
  }
}

/**
 * Create a timeout promise that can be cancelled
 */
export function createTimeoutPromise(ms, message = 'Operation timed out') {
  let timeoutId;
  let rejectFn;

  const promise = new Promise((resolve, reject) => {
    rejectFn = reject;
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  promise.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };

  return promise;
}

export default {
  createTestEnvironment,
  waitForPendingAsync,
  createMockLogger,
  safeCleanup,
  createTimeoutPromise
};
