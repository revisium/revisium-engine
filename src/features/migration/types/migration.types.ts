export const MigrationStatus = {
  PENDING: 'PENDING',
  COPYING: 'COPYING',
  SWAPPING: 'SWAPPING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type MigrationStatus =
  (typeof MigrationStatus)[keyof typeof MigrationStatus];

export const MigrationPhase = {
  INIT: 'INIT',
  COPYING: 'COPYING',
  VALIDATING: 'VALIDATING',
  SWAPPING: 'SWAPPING',
  CLEANUP: 'CLEANUP',
  DONE: 'DONE',
} as const;

export type MigrationPhase =
  (typeof MigrationPhase)[keyof typeof MigrationPhase];

export const ACTIVE_MIGRATION_STATUSES: MigrationStatus[] = [
  MigrationStatus.PENDING,
  MigrationStatus.COPYING,
  MigrationStatus.SWAPPING,
];

export interface MigrationProgress {
  percentage: number;
  copiedRows: number;
  totalRows: number;
}

export interface MigrationStatusResult {
  migrationId: string;
  revisionId: string;
  tableId: string;
  status: MigrationStatus;
  phase: MigrationPhase;
  progress: MigrationProgress;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
}

export interface ActiveMigrationResult {
  migrationId: string;
  tableId: string;
  status: MigrationStatus;
  progress: MigrationProgress;
}

export interface StartAsyncMigrationResult {
  migrationId: string;
  status: 'migrating';
}
