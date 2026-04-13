export const MIGRATION_DEFAULTS = {
  threshold: 1000,
  batchSize: 1000,
  workerMode: 'inline' as const,
  pollIntervalMs: 5000,
  heartbeatIntervalMs: 30000,
  lockTimeoutMs: 60000,
  stallTimeoutMs: 600000,
  maxRetries: 3,
};

export const MIGRATION_OPTIONS = 'MIGRATION_OPTIONS';
export const PERCENTAGE_MULTIPLIER = 100;
export const WORKER_ID_SUFFIX_LENGTH = 8;
