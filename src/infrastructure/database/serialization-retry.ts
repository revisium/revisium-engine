import { setTimeout as waitFor } from 'node:timers/promises';
import { isSerializationFailure } from 'src/infrastructure/database/database-errors';
import {
  RetryBackoff,
  retryDelayMs,
} from 'src/infrastructure/database/retry-backoff';

const SERIALIZATION_FAILURES_BEFORE_ESCALATION = 2;

export interface SerializationRetryLimits {
  readonly maxAttempts: number;
  readonly backoff: RetryBackoff;
}

export interface SerializableAttempt<T> {
  run(): Promise<T>;
  runEscalated(): Promise<T>;
}

export async function retryOnSerializationFailure<T>(
  { maxAttempts, backoff }: SerializationRetryLimits,
  serializable: SerializableAttempt<T>,
): Promise<T> {
  const lastAttempt = maxAttempts - 1;

  for (let attempt = 0; attempt < lastAttempt; attempt++) {
    try {
      return await runAttempt(attempt, serializable);
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }

      await waitFor(retryDelayMs(attempt, backoff));
    }
  }

  return runAttempt(lastAttempt, serializable);
}

// Every attempt before this one failed serialization, so its number counts the consecutive failures.
function runAttempt<T>(
  attempt: number,
  serializable: SerializableAttempt<T>,
): Promise<T> {
  if (attempt < SERIALIZATION_FAILURES_BEFORE_ESCALATION) {
    return serializable.run();
  }

  return serializable.runEscalated();
}
