import { randomInt } from 'node:crypto';

const BACKOFF_BASE = 2;
const JITTER_FACTOR = 0.5;

export interface RetryBackoff {
  baseDelayMs: number;
  maxDelayMs: number;
}

export function retryDelayMs(
  attempt: number,
  { baseDelayMs, maxDelayMs }: RetryBackoff,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(BACKOFF_BASE, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const maxJitter = Math.floor(cappedDelay * JITTER_FACTOR);
  const jitter = maxJitter > 0 ? randomInt(maxJitter + 1) : 0;
  return cappedDelay + jitter;
}
