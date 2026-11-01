import { Injectable } from '@nestjs/common';
import type { JsonPatch, Migration } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import type {
  DraftRevisionCreateRowsRowData,
  DraftRevisionUpdateRowsRowData,
} from 'src/features/draft-revision/commands/impl';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import type {
  PlannedTableRepair,
  RenumberedMigration,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { pendingSchemaHistory } from 'src/features/share/ledger/schema-history';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { DraftLedger } from './draft-ledger';
import { repairMigrationOf } from './repair-patch';
import { type PlannedRepair, repairedTablesOf } from './repair-planning';
import type { RepairState, StoredSchema } from './repair-state-reader';

interface TableRepairRecord {
  readonly tableId: string;
  readonly migrationId: string;
  readonly patches: readonly JsonPatch[];
}

@Injectable()
export class RepairWriter {
  constructor(
    private readonly draftRevisionApi: DraftRevisionApiService,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  public async record({ state, plan }: PlannedRepair): Promise<void> {
    const repairs = repairedTablesOf(plan).map(repairRecordOf);

    await this.removeRenumberedMigrations(state, plan.renumbered);
    await this.recordMigrations(state, [
      ...repairs.map((repair) => this.repairMigrationRowOf(state, repair)),
      ...plan.renumbered.map((renumbered) =>
        renumberedMigrationRowOf(state, renumbered),
      ),
    ]);
    await this.extendSchemaHistories(state, repairs);
  }

  private async removeRenumberedMigrations(
    state: RepairState,
    renumbered: readonly RenumberedMigration[],
  ): Promise<void> {
    if (renumbered.length === 0) {
      return;
    }

    await this.draftRevisionApi.removeRows({
      revisionId: state.draftRevisionId,
      tableId: SystemTables.Migration,
      rowIds: renumbered.map(({ previousId }) => previousId),
    });
  }

  private async recordMigrations(
    state: RepairState,
    rows: DraftRevisionCreateRowsRowData[],
  ): Promise<void> {
    await this.draftRevisionApi.createRows({
      revisionId: state.draftRevisionId,
      tableId: SystemTables.Migration,
      rows,
    });
  }

  private async extendSchemaHistories(
    state: RepairState,
    repairs: readonly TableRepairRecord[],
  ): Promise<void> {
    const draftLedger = new DraftLedger(state);

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
      publishedAt: new Date(migrationId),
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

function renumberedMigrationRowOf(
  state: RepairState,
  { previousId, id }: RenumberedMigration,
): DraftRevisionCreateRowsRowData {
  const source = pendingMigrationRowOf(state, previousId);
  const migration = source.data as unknown as Migration;

  return {
    rowId: id,
    data: { ...migration, id } as unknown as InputJsonValue,
    schemaHash: source.schemaHash,
    meta: source.meta as unknown as InputJsonValue,
    publishedAt: new Date(id),
  };
}

function repairedSchemaRowOf(
  state: RepairState,
  draftLedger: DraftLedger,
  { tableId, patches }: TableRepairRecord,
): DraftRevisionUpdateRowsRowData {
  const draftTableId = requiredOf(
    draftLedger.draftTableIdOf(tableId),
    `Draft table of ${tableId}`,
  );
  const head = headSchemaOf(state, tableId);
  const draft = requiredOf(
    state.draft.schemas.get(draftTableId),
    `Draft schema row of ${draftTableId}`,
  );

  return {
    rowId: draftTableId,
    data: draft.schema as InputJsonValue,
    meta: repairedHistoryOf(head, draft, patches) as unknown as InputJsonValue,
  };
}

function repairedHistoryOf(
  head: StoredSchema,
  draft: StoredSchema,
  patches: readonly JsonPatch[],
): HistoryPatches[] {
  const pending = pendingSchemaHistory(head.history, draft.history);

  if (!pending.extendsHead) {
    throw new Error('The repair found a Draft history that leaves its Head');
  }

  const repairEntry: HistoryPatches = {
    patches: [...patches],
    hash: objectHash(head.schema),
    date: new Date().toISOString(),
  };

  return [...head.history, repairEntry, ...pending.entries];
}

function headSchemaOf(state: RepairState, tableId: string): StoredSchema {
  return requiredOf(
    state.head.schemas.get(tableId),
    `Head schema row of ${tableId}`,
  );
}

function pendingMigrationRowOf(state: RepairState, migrationId: string): Row {
  return requiredOf(
    state.draft.migrationRows.find(({ id }) => id === migrationId),
    `pending migration ${migrationId}`,
  );
}

function requiredOf<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`The repair found no ${description}`);
  }

  return value;
}
