import type { TestingModuleBuilder } from '@nestjs/testing';
import { MigrationRecoveryScope } from 'src/features/migration/services/migration-recovery-scope';

// Recovery acts on every migration record of the shared test database, so a test kit recovers only the records a test names.
export class ExplicitMigrationRecoveryScope extends MigrationRecoveryScope {
  private readonly migrationIds = new Set<string>();

  constructor(migrationIds: readonly string[] = []) {
    super();
    this.include(...migrationIds);
  }

  include(...migrationIds: string[]): void {
    for (const migrationId of migrationIds) {
      this.migrationIds.add(migrationId);
    }
  }

  override restrictedTo(): readonly string[] {
    return [...this.migrationIds];
  }
}

export function restrictMigrationRecovery(
  builder: TestingModuleBuilder,
  scope: MigrationRecoveryScope = new ExplicitMigrationRecoveryScope(),
): TestingModuleBuilder {
  return builder.overrideProvider(MigrationRecoveryScope).useValue(scope);
}
