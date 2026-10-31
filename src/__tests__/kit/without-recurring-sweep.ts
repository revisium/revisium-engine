import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';

const ONE_HOUR_MS = 3_600_000;

// A sweep acts on every migration record of the shared test database, so test kits sweep only when a test asks for it.
export const WITHOUT_RECURRING_SWEEP = {
  pollIntervalMs: ONE_HOUR_MS,
} satisfies MigrationOptions;
