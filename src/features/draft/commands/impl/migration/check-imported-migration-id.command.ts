import { BadRequestException } from '@nestjs/common';

export class CheckImportedMigrationIdCommand {
  constructor(
    public readonly revisionId: string,
    public readonly migrationId?: string,
  ) {}
}

export class MigrationAlreadyAppliedException extends BadRequestException {
  constructor(migrationId: string) {
    super(`Migration ${migrationId} is already applied`);
  }
}

export class MigrationIdOutOfOrderException extends BadRequestException {
  constructor(migrationId: string, lastMigrationDate: Date) {
    super(
      `Provided id (${migrationId}) must be after last migration date (${lastMigrationDate.toISOString()}).`,
    );
  }
}
