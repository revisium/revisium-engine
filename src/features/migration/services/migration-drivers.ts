import { Injectable, Logger } from '@nestjs/common';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';

@Injectable()
export class MigrationDrivers {
  private readonly logger = new Logger(MigrationDrivers.name);
  private readonly drivenMigrationIds = new Map<Promise<void>, string>();
  private isStopped = false;

  isDriving(migrationId: string): boolean {
    return [...this.drivenMigrationIds.values()].includes(migrationId);
  }

  drive(migrationId: string, run: () => Promise<MigrationStepResult>): void {
    if (this.isStopped) {
      return;
    }

    const driver = this.runLoggingFailure(migrationId, run).finally(() => {
      this.drivenMigrationIds.delete(driver);
    });
    this.drivenMigrationIds.set(driver, migrationId);
  }

  async stop(): Promise<void> {
    this.isStopped = true;
    await Promise.allSettled(this.drivenMigrationIds.keys());
  }

  private async runLoggingFailure(
    migrationId: string,
    run: () => Promise<MigrationStepResult>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Migration ${migrationId} failed: ${message}`);
    }
  }
}
