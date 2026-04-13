import { HttpException, HttpStatus } from '@nestjs/common';
import { MigrationProgress } from 'src/features/migration/types/migration.types';

export interface MigrationLockedDetails {
  migrationId: string;
  tableId: string;
  status: string;
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
