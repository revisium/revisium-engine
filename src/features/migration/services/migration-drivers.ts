import { Injectable, Logger } from '@nestjs/common';
import type { MigrationStepResult } from 'src/features/migration/types/migration.types';

type DriverRun = () => Promise<MigrationStepResult>;

@Injectable()
export class MigrationDrivers {
  private readonly logger = new Logger(MigrationDrivers.name);
  private readonly drivenMigrationIds = new Map<Promise<void>, string>();
  private isStopped = false;

  driveUnlessDriven(migrationId: string, run: DriverRun): boolean {
    if (this.isStopped || this.isDriving(migrationId)) {
      return false;
    }

    this.start(migrationId, run);
    return true;
  }

  driveTakeover(migrationId: string, run: DriverRun): void {
    if (this.isStopped) {
      return;
    }

    this.start(migrationId, run);
  }

  async stop(): Promise<void> {
    this.isStopped = true;
    await Promise.allSettled(this.drivenMigrationIds.keys());
  }

  private isDriving(migrationId: string): boolean {
    return [...this.drivenMigrationIds.values()].includes(migrationId);
  }

  private start(migrationId: string, run: DriverRun): void {
    const driver = this.runLoggingFailure(migrationId, run).finally(() => {
      this.drivenMigrationIds.delete(driver);
    });
    this.drivenMigrationIds.set(driver, migrationId);
  }

  private async runLoggingFailure(
    migrationId: string,
    run: DriverRun,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Migration ${migrationId} failed: ${message}`);
    }
  }
}
