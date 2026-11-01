import { type DynamicModule, Module } from '@nestjs/common';
import {
  MIGRATION_RECOVERY_TEST_SCOPE,
  type MigrationRecoveryTestScope,
} from 'src/features/migration/services/migration-recovery-test-scope';

export class ExplicitMigrationRecoveryScope implements MigrationRecoveryTestScope {
  private readonly migrationIds = new Set<string>();

  constructor(migrationIds: readonly string[] = []) {
    this.include(...migrationIds);
  }

  include(...migrationIds: string[]): void {
    for (const migrationId of migrationIds) {
      this.migrationIds.add(migrationId);
    }
  }

  restrictedTo(): readonly string[] {
    return [...this.migrationIds];
  }
}

@Module({})
class MigrationRecoveryTestScopeModule {}

export function restrictedMigrationRecovery(
  scope: MigrationRecoveryTestScope = new ExplicitMigrationRecoveryScope(),
): DynamicModule {
  return {
    module: MigrationRecoveryTestScopeModule,
    global: true,
    providers: [{ provide: MIGRATION_RECOVERY_TEST_SCOPE, useValue: scope }],
    exports: [MIGRATION_RECOVERY_TEST_SCOPE],
  };
}
