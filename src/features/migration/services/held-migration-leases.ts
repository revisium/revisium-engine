import { Injectable } from '@nestjs/common';
import type { MigrationLease } from 'src/features/migration/services/migration-transition.service';

@Injectable()
export class HeldMigrationLeases {
  private readonly leasesByToken = new Map<string, MigrationLease>();

  list(): MigrationLease[] {
    return [...this.leasesByToken.values()];
  }

  hold(lease: MigrationLease): void {
    this.leasesByToken.set(lease.token, lease);
  }

  release(lease: MigrationLease): void {
    this.leasesByToken.delete(lease.token);
  }
}
