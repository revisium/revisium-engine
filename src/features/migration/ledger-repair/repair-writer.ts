import { Injectable } from '@nestjs/common';
import type { JsonPatch, Migration } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type {
  DraftRevisionCreateRowsRowData,
  DraftRevisionUpdateRowsRowData,
} from 'src/features/draft-revision/commands/impl';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import type {
  PlannedTableRepair,
  RenumberedMigration,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { StoredTableVersion } from 'src/features/share/branch-revisions/branch-revision-reader';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type {
  LedgerEntry,
  StoredSchema,
} from 'src/features/share/ledger/migration-ledger';
import {
  publishedAtOf,
  renumberedMigrationRowOf,
} from 'src/features/share/ledger/native-migration-id';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { DraftLedger, type TableHistories } from './draft-ledger';
import {
  type PlannedRepair,
  repairedTablesOf,
} from './ledger-repair-plan.service';
import { repairMigrationOf } from './repair-patch';
import type { RepairState } from './repair-state-reader';

interface TableRepairRecord {
  readonly tableId: string;
  readonly migrationId: string;
  readonly patches: readonly JsonPatch[];
}

@Injectable()
export class RepairWriter {
  constructor(
    private readonly draftRevisionApi: DraftRevisionApiService,
    private readonly targetApi: DraftRevisionTargetApiService,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  public async record({ state, plan }: PlannedRepair): Promise<void> {
    const draftLedger = new DraftLedger(state);
    const repairs = repairedTablesOf(plan).map(repairRecordOf);

    await this.renumberPendingMigrations(state, draftLedger, plan.renumbered);
    await this.recordRepairMigrations(state, repairs);
    await this.extendSchemaHistories(state, draftLedger, repairs);
  }

  private async renumberPendingMigrations(
    state: RepairState,
    draftLedger: DraftLedger,
    renumbered: readonly RenumberedMigration[],
  ): Promise<void> {
    if (renumbered.length === 0) {
      return;
    }

    const renumberings = renumbered.map(({ previousId, id }) => ({
      source: pendingEntryOf(draftLedger, previousId).row,
      id,
    }));
    const migrationTable = draftMigrationTableOf(state);

    await this.targetApi.replaceDraftRowVersions({
      headRevisionId: state.headRevisionId,
      draftRevisionId: state.draftRevisionId,
      tableId: SystemTables.Migration,
      draftTableVersionId: migrationTable.versionId,
      editInPlace: !migrationTable.readonly,
      replacedRowVersionIds: renumberings.map(({ source }) => source.versionId),
      newRows: renumberings.map(({ source, id }) =>
        renumberedMigrationRowOf(source, id),
      ),
    });
  }

  private async recordRepairMigrations(
    state: RepairState,
    repairs: readonly TableRepairRecord[],
  ): Promise<void> {
    await this.draftRevisionApi.createRows({
      revisionId: state.draftRevisionId,
      tableId: SystemTables.Migration,
      rows: repairs.map((repair) => this.repairMigrationRowOf(state, repair)),
    });
  }

  private async extendSchemaHistories(
    state: RepairState,
    draftLedger: DraftLedger,
    repairs: readonly TableRepairRecord[],
  ): Promise<void> {
    await this.draftRevisionApi.updateRows({
      revisionId: state.draftRevisionId,
      tableId: SystemTables.Schema,
      rows: repairs.map((repair) =>
        repairedSchemaRowOf(state, draftLedger, repair),
      ),
    });
  }

  private repairMigrationRowOf(
    state: RepairState,
    { tableId, migrationId, patches }: TableRepairRecord,
  ): DraftRevisionCreateRowsRowData {
    const migration = repairMigrationOf(
      tableId,
      {
        patches: [...patches],
        hash: objectHash(headSchemaOf(state, tableId).schema),
      },
      migrationId,
    );

    return {
      rowId: migrationId,
      data: migration as unknown as InputJsonValue,
      schemaHash: this.validator.tableSchemaHash,
      publishedAt: publishedAtOf(migrationId),
    };
  }
}

function repairRecordOf({
  tableId,
  migrationId,
  patches,
}: PlannedTableRepair): TableRepairRecord {
  return {
    tableId,
    migrationId: requiredOf(migrationId, `repair migration id of ${tableId}`),
    patches: requiredOf(patches, `repair patches of ${tableId}`),
  };
}

function repairedSchemaRowOf(
  state: RepairState,
  draftLedger: DraftLedger,
  { tableId, patches }: TableRepairRecord,
): DraftRevisionUpdateRowsRowData {
  const histories = requiredOf(
    draftLedger.historiesOf(tableId),
    `Draft schema history of ${tableId}`,
  );
  const head = headSchemaOf(state, tableId);
  const draft = requiredOf(
    state.draft.schemas.get(histories.draftTableId),
    `Draft schema row of ${histories.draftTableId}`,
  );

  return {
    rowId: histories.draftTableId,
    data: draft.schema as InputJsonValue,
    meta: repairedHistoryOf(
      head,
      histories,
      patches,
    ) as unknown as InputJsonValue,
  };
}

function repairedHistoryOf(
  head: StoredSchema,
  { inherited, pending }: TableHistories,
  patches: readonly JsonPatch[],
): HistoryPatches[] {
  const repairEntry: HistoryPatches = {
    patches: [...patches],
    hash: objectHash(head.schema),
    date: new Date().toISOString(),
  };

  return [...inherited, repairEntry, ...pending];
}

function headSchemaOf(state: RepairState, tableId: string): StoredSchema {
  return requiredOf(
    state.head.schemas.get(tableId),
    `Head schema row of ${tableId}`,
  );
}

function draftMigrationTableOf(state: RepairState): StoredTableVersion {
  return requiredOf(state.draft.migrationTable, 'Draft migration table');
}

function pendingEntryOf(
  draftLedger: DraftLedger,
  migrationId: Migration['id'],
): LedgerEntry {
  return requiredOf(
    draftLedger.pending.find(({ migration }) => migration.id === migrationId),
    `pending migration ${migrationId}`,
  );
}

function requiredOf<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`The repair found no ${description}`);
  }

  return value;
}
