import { HttpException, HttpStatus } from '@nestjs/common';
import {
  MigrationProgress,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';

export interface MigrationLockedDetails {
  migrationId: string;
  tableId: string;
  status: MigrationStatus;
  progress: MigrationProgress;
}

export class MigrationLockedException extends HttpException {
  constructor(details: MigrationLockedDetails) {
    super(
      {
        statusCode: HttpStatus.LOCKED,
        message: `Revision is locked by an active migration on table "${details.tableId}" (${details.status})`,
        migration: details,
      },
      HttpStatus.LOCKED,
    );
  }
}
