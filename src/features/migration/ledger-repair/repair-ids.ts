import type { Migration } from '@revisium/schema-toolkit/types';
import type { LedgerEntry } from 'src/features/share/ledger/migration-ledger';
import {
  type MigrationBounds,
  type MigrationRenumbering,
  NativeIdSequence,
  publishedAtOf,
} from 'src/features/share/ledger/native-migration-id';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

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
): MigrationRenumbering[] {
  if (pending.every(({ id }) => compareCodePoints(id, lastRepairId) > 0)) {
    return [];
  }

  const sequence = new NativeIdSequence({
    id: lastRepairId,
    publishedAt: publishedAtOf(lastRepairId),
  });

  return pending.map(({ id }) => ({ from: id, to: sequence.next() }));
}

export function withRenumberedIds(
  pending: readonly Migration[],
  renumbered: readonly MigrationRenumbering[],
): Migration[] {
  const ids = new Map(renumbered.map(({ from, to }) => [from, to]));

  return pending.map((migration) => ({
    ...migration,
    id: ids.get(migration.id) ?? migration.id,
  }));
}
