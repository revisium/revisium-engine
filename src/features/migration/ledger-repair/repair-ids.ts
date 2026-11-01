import type { Migration } from '@revisium/schema-toolkit/types';
import { nextNativeMigrationId } from 'src/features/draft/commands/handlers/migration/native-migration-id';
import type { RenumberedMigration } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { LedgerEntry } from 'src/features/share/ledger/migration-ledger';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface MigrationBounds {
  readonly id: string | null;
  readonly publishedAt: Date | null;
}

export class NativeIdSequence {
  constructor(private bounds: MigrationBounds) {}

  public next(): string {
    const id = nextNativeMigrationId(this.bounds);
    this.bounds = { id, publishedAt: new Date(id) };

    return id;
  }
}

export function lastPublishedBoundsOf(
  published: readonly LedgerEntry[],
): MigrationBounds {
  const last = published.at(-1);

  if (!last) {
    return { id: null, publishedAt: null };
  }

  const publishedAt = published.reduce(
    (latest, { row }) => Math.max(latest, row.publishedAt.getTime()),
    0,
  );

  return { id: last.migration.id, publishedAt: new Date(publishedAt) };
}

export function renumberedAfter(
  lastRepairId: string,
  pending: readonly Migration[],
): RenumberedMigration[] {
  if (pending.every(({ id }) => compareCodePoints(id, lastRepairId) > 0)) {
    return [];
  }

  const sequence = new NativeIdSequence({
    id: lastRepairId,
    publishedAt: new Date(lastRepairId),
  });

  return pending.map(({ id }) => ({ previousId: id, id: sequence.next() }));
}

export function withRenumberedIds(
  pending: readonly Migration[],
  renumbered: readonly RenumberedMigration[],
): Migration[] {
  const ids = new Map(renumbered.map(({ previousId, id }) => [previousId, id]));

  return pending.map((migration) => ({
    ...migration,
    id: ids.get(migration.id) ?? migration.id,
  }));
}
