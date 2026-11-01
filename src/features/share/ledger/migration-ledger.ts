import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { Migration } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface LedgerEntry {
  readonly row: Row;
  readonly migration: Migration;
}

export interface SplitLedger {
  readonly published: readonly LedgerEntry[];
  readonly pending: readonly LedgerEntry[];
}

export function ledgerOf(rows: readonly Row[]): LedgerEntry[] {
  return [...rows]
    .sort((left, right) => compareCodePoints(left.id, right.id))
    .map((row) => ({ row, migration: migrationOf(row) }));
}

export function migrationsOf(entries: readonly LedgerEntry[]): Migration[] {
  return entries.map(({ migration }) => migration);
}

export function splitLedger(
  headRows: readonly Row[],
  draftRows: readonly Row[],
): SplitLedger {
  const publishedVersionIds = new Set(
    headRows.map(({ versionId }) => versionId),
  );

  return {
    published: ledgerOf(headRows),
    pending: ledgerOf(
      draftRows.filter(({ versionId }) => !publishedVersionIds.has(versionId)),
    ),
  };
}

export function storesMigrationsUnderTheirIds(rows: readonly Row[]): boolean {
  const rowIds = new Set(rows.map(({ id }) => id));

  return (
    rowIds.size === rows.length &&
    rows.every((row) => migrationOf(row).id === row.id)
  );
}

export function hasIntactPublishedPrefix(
  headRows: readonly Row[],
  draftRows: readonly Row[],
): boolean {
  const draftRowsById = new Map(draftRows.map((row) => [row.id, row]));

  return headRows.every((published) =>
    isSamePublishedRow(draftRowsById.get(published.id), published),
  );
}

function isSamePublishedRow(draft: Row | undefined, published: Row): boolean {
  return (
    draft !== undefined &&
    deepEqual(draft.data, published.data) &&
    draft.publishedAt.getTime() === published.publishedAt.getTime()
  );
}

function migrationOf(row: Row): Migration {
  return row.data as unknown as Migration;
}
