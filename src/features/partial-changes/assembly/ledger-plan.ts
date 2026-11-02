import objectHash from 'object-hash';
import type { Row } from 'src/engine-prisma-types';
import type { NewRowVersion } from 'src/features/draft-revision/commands/impl/target-write-plan';
import { nextNativeMigrationId } from 'src/features/draft/commands/handlers/migration/native-migration-id';
import type { OutcomeRules } from 'src/features/partial-changes/assembly/outcome-rules';
import { targetLedgerRowsOf } from 'src/features/partial-changes/assembly/system-table-targets';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import {
  type LedgerEntry,
  ledgerOf,
} from 'src/features/share/ledger/migration-ledger';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface RenumberedMigrationRow {
  readonly source: LedgerEntry;
  readonly row: NewRowVersion;
}

export interface LedgerPlan {
  readonly renumbered: readonly RenumberedMigrationRow[];
}

interface MigrationBounds {
  readonly id: string;
  readonly publishedAt: Date;
}

const NOTHING_RENUMBERED: LedgerPlan = { renumbered: [] };

export function planLedger(
  source: AssemblySource,
  rules: OutcomeRules,
): LedgerPlan {
  if (rules.operation !== 'commit') {
    return NOTHING_RENUMBERED;
  }

  const target = ledgerOf(targetLedgerRowsOf(source, rules));
  const remaining = remainingEntriesOf(
    source.snapshot.systemRows.migrations.draft,
    target,
  );
  const bounds = boundsOf(target);

  if (!bounds || remaining.every(({ row }) => follows(row.id, bounds))) {
    return NOTHING_RENUMBERED;
  }

  return { renumbered: renumberedAfter(bounds, remaining) };
}

function remainingEntriesOf(
  draftRows: readonly Row[],
  target: readonly LedgerEntry[],
): LedgerEntry[] {
  const targetVersionIds = new Set(target.map(({ row }) => row.versionId));

  return ledgerOf(
    draftRows.filter(({ versionId }) => !targetVersionIds.has(versionId)),
  );
}

function boundsOf(target: readonly LedgerEntry[]): MigrationBounds | undefined {
  const greatest = target.at(-1);

  if (!greatest) {
    return undefined;
  }

  const latestPublishedAt = target.reduce(
    (latest, { row }) => Math.max(latest, row.publishedAt.getTime()),
    0,
  );

  return { id: greatest.row.id, publishedAt: new Date(latestPublishedAt) };
}

function follows(id: string, bounds: MigrationBounds): boolean {
  return compareCodePoints(id, bounds.id) > 0;
}

function renumberedAfter(
  start: MigrationBounds,
  remaining: readonly LedgerEntry[],
): RenumberedMigrationRow[] {
  const renumbered: RenumberedMigrationRow[] = [];
  let bounds = start;

  for (const source of remaining) {
    const id = nextNativeMigrationId(bounds);

    renumbered.push({ source, row: renumberedMigrationRowOf(source, id) });
    bounds = { id, publishedAt: new Date(id) };
  }

  return renumbered;
}

// Mirrors the renumbering of the ledger repair (ledger-repair/repair-writer.ts, renumberedRowOf).
function renumberedMigrationRowOf(
  { row, migration }: LedgerEntry,
  newId: string,
): NewRowVersion {
  const data = { ...migration, id: newId };

  return {
    createdId: row.createdId,
    createdAt: row.createdAt,
    schemaHash: row.schemaHash,
    meta: row.meta,
    id: newId,
    data: data as unknown as NewRowVersion['data'],
    hash: objectHash(data),
    publishedAt: new Date(newId),
  };
}
