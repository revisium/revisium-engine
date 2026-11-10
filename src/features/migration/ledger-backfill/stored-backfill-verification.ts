import { Injectable } from '@nestjs/common';
import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import {
  BranchRevisionReader,
  type StoredTable,
  systemTableOf,
} from 'src/features/share/branch-revisions/branch-revision-reader';
import {
  ledgerOf,
  migrationsOf,
} from 'src/features/share/ledger/migration-ledger';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { checkTableSlot } from 'src/features/share/ledger-replay/slot-check';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import type { BackfillMigration } from './backfill-migrations';
import type { CommittedBackfill } from './backfill-writer';

@Injectable()
export class StoredBackfillVerification {
  constructor(
    private readonly revisionReader: BranchRevisionReader,
    private readonly replayer: LedgerReplayer,
  ) {}

  public async verify(
    committed: CommittedBackfill,
    migrations: readonly BackfillMigration[],
  ): Promise<void> {
    const defect = await this.defectOf(committed, migrations);

    if (defect !== undefined) {
      throw new Error(`The backfilled ledger ${defect}`);
    }
  }

  private async defectOf(
    { headRevisionId, draftRevisionId }: CommittedBackfill,
    migrations: readonly BackfillMigration[],
  ): Promise<string | undefined> {
    const headTables = await this.revisionReader.readTables(headRevisionId);
    const draftTables = await this.revisionReader.readTables(draftRevisionId);
    const headLedger = systemTableOf(headTables, SystemTables.Migration);
    const draftLedger = systemTableOf(draftTables, SystemTables.Migration);

    if (!headLedger || draftLedger?.versionId !== headLedger.versionId) {
      return 'is not one table version that the new Head and the new Draft link';
    }

    if (!headLedger.readonly) {
      return 'is not readonly in the new Head';
    }

    const stored = await this.revisionReader.readSystemRows(headTables, [
      SystemTables.Schema,
      SystemTables.Migration,
    ]);

    if (!holdsExactly(stored[SystemTables.Migration].rows, migrations)) {
      return 'does not hold exactly the planned entries under ascending ids';
    }

    const unreproduced = this.unreproducedHeadTable(
      headTables,
      stored[SystemTables.Schema].rows,
      stored[SystemTables.Migration].rows,
    );

    if (unreproduced !== undefined) {
      return `does not reproduce the Head schema of ${unreproduced}`;
    }

    return undefined;
  }

  // The predicate of the head-schema check (partial-changes §6.10) for every Head user table.
  private unreproducedHeadTable(
    headTables: readonly StoredTable[],
    schemaRows: readonly Row[],
    ledgerRows: readonly Row[],
  ): string | undefined {
    const schemas = new Map(
      schemaRows.map(({ id, data }) => [id, data as unknown as JsonSchema]),
    );
    const replay = this.replayer.replay(migrationsOf(ledgerOf(ledgerRows)));

    return headTables
      .filter(({ system }) => !system)
      .map(({ id }) => id)
      .sort(compareCodePoints)
      .find(
        (tableId) =>
          checkTableSlot(replay, tableId, schemas.get(tableId)).kind !==
          'reproduces',
      );
  }
}

function holdsExactly(
  rows: readonly Row[],
  migrations: readonly BackfillMigration[],
): boolean {
  const stored = ledgerOf(rows);

  return (
    stored.length === migrations.length &&
    hasAscendingIds(migrations) &&
    migrations.every((migration, index) =>
      isStoredAs(stored[index]?.row, migration),
    )
  );
}

function isStoredAs(
  row: Row | undefined,
  migration: BackfillMigration,
): boolean {
  return (
    row !== undefined &&
    row.readonly &&
    row.id === migration.id &&
    deepEqual(row.data, migration)
  );
}

function hasAscendingIds(migrations: readonly BackfillMigration[]): boolean {
  return migrations.every(({ id }, index) => {
    const previous = migrations[index - 1];

    return previous === undefined || compareCodePoints(previous.id, id) < 0;
  });
}
