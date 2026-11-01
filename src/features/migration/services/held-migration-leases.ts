import { Injectable } from '@nestjs/common';
import type { MigrationLease } from 'src/features/migration/services/migration-ownership';

@Injectable()
export class HeldMigrationLeases {
  private readonly leasesByToken = new Map<string, MigrationLease>();
  private pendingAcquisitions = 0;

  get isEmpty(): boolean {
    return this.pendingAcquisitions === 0 && this.leasesByToken.size === 0;
  }

  list(): MigrationLease[] {
    return [...this.leasesByToken.values()];
  }

  async acquire(
    attempt: () => Promise<MigrationLease | null>,
  ): Promise<MigrationLease | null> {
    this.pendingAcquisitions += 1;

    try {
      const lease = await attempt();

      if (lease) {
        this.leasesByToken.set(lease.token, lease);
      }

      return lease;
    } finally {
      this.pendingAcquisitions -= 1;
    }
  }

  release(lease: MigrationLease): void {
    this.leasesByToken.delete(lease.token);
  }
}
