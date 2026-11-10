import type {
  InitMigration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import {
  type MigrationBounds,
  nextNativeMigrationId,
  publishedAtOf,
} from 'src/features/share/ledger/native-migration-id';
import type { OrderedLedger } from './backfill-order';

export type BackfillMigration = InitMigration | UpdateMigration;

export function backfillMigrationsOf({
  inits,
  updates,
}: OrderedLedger): BackfillMigration[] {
  const ids = new MigrationIdSequence();

  return [
    ...inits.map(
      ({ tableId, schema }): InitMigration => ({
        changeType: 'init',
        tableId,
        id: ids.next(),
        hash: objectHash(schema),
        schema,
      }),
    ),
    ...updates.map(
      ({ tableId, headSchema, patches }): UpdateMigration => ({
        changeType: 'update',
        tableId,
        id: ids.next(),
        hash: objectHash(headSchema),
        patches,
      }),
    ),
  ];
}

class MigrationIdSequence {
  private previous: string | null = null;

  public next(): string {
    const id = nextNativeMigrationId(this.bounds());
    this.previous = id;

    return id;
  }

  private bounds(): MigrationBounds {
    if (this.previous === null) {
      return { id: null, publishedAt: null };
    }

    return { id: this.previous, publishedAt: publishedAtOf(this.previous) };
  }
}
