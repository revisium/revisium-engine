import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  InvalidRows,
  PlannedTableRepair,
  SchemaLedgerRepairPlan,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import {
  type DraftTable,
  DraftRowsValidation,
  type ValidatedRows,
} from './draft-rows-validation';
import {
  RepairLedger,
  type StoredLedgerReplays,
  storedLedgerReplayOf,
  type TableAssessment,
} from './repair-ledger';
import { RepairPlanner } from './repair-planner';
import type { RepairState } from './repair-state-reader';

export interface RepairPlanningOptions {
  readonly tableIds?: readonly string[];
  readonly storedReplays?: Partial<StoredLedgerReplays>;
}

export interface PlannedRepair {
  readonly state: RepairState;
  readonly plan: SchemaLedgerRepairPlan;
}

@Injectable()
export class RepairPlanning {
  constructor(
    private readonly draftRows: DraftRowsValidation,
    private readonly schemaStore: JsonSchemaStoreService,
    private readonly validator: JsonSchemaValidatorService,
    private readonly replayer: LedgerReplayer,
  ) {}

  public async plan(
    state: RepairState,
    { tableIds, storedReplays = {} }: RepairPlanningOptions = {},
  ): Promise<SchemaLedgerRepairPlan> {
    const ledger = new RepairLedger(state, this.replayer, this.validator, {
      head:
        storedReplays.head ?? storedLedgerReplayOf(state.head, this.replayer),
      draft:
        storedReplays.draft ?? storedLedgerReplayOf(state.draft, this.replayer),
    });
    const assessments = assessmentsOf(
      ledger,
      requestedTableIdsOf(state, ledger, tableIds),
    );
    const draftTables = validatedDraftTablesOf(state, assessments);
    const validatedRows = await this.validateDraftRows(state, draftTables);
    const planned = new RepairPlanner(
      ledger,
      this.validator,
      this.schemaStore.refs,
    ).plan(assessments, invalidRowsOf(validatedRows));

    return {
      headRevisionId: state.headRevisionId,
      draftRevisionId: state.draftRevisionId,
      tables: planned.tables,
      renumbered: planned.renumbered,
      fingerprint: await this.draftRows.fingerprintOf(
        [...draftTables.values()].map(({ versionId }) => versionId),
        consultedTableVersionIdsOf(state, validatedRows),
      ),
    };
  }

  private async validateDraftRows(
    state: RepairState,
    draftTables: ReadonlyMap<string, DraftTable>,
  ): Promise<Map<string, ValidatedRows>> {
    const validatedRows = new Map<string, ValidatedRows>();

    for (const [tableId, draftTable] of draftTables) {
      validatedRows.set(
        tableId,
        await this.draftRows.validateRows(state.draftRevisionId, draftTable),
      );
    }

    return validatedRows;
  }
}

export function repairedTablesOf(
  plan: SchemaLedgerRepairPlan,
): PlannedTableRepair[] {
  return plan.tables.filter(({ outcome }) => outcome === 'repaired');
}

function requestedTableIdsOf(
  state: RepairState,
  ledger: RepairLedger,
  tableIds: readonly string[] | undefined,
): string[] {
  if (!tableIds) {
    return [...ledger.damagedTableIds];
  }

  const unknownTableId = tableIds.find(
    (tableId) => !state.head.tableVersionIds.has(tableId),
  );

  if (unknownTableId !== undefined) {
    throw new BadRequestException(`Unknown Head table "${unknownTableId}"`);
  }

  return [...new Set(tableIds)];
}

function assessmentsOf(
  ledger: RepairLedger,
  tableIds: readonly string[],
): Map<string, TableAssessment> {
  return new Map(tableIds.map((tableId) => [tableId, ledger.assess(tableId)]));
}

function validatedDraftTablesOf(
  state: RepairState,
  assessments: ReadonlyMap<string, TableAssessment>,
): Map<string, DraftTable> {
  const draftTables = new Map<string, DraftTable>();

  for (const [tableId, assessment] of assessments) {
    if (!('baseline' in assessment)) {
      continue;
    }

    const draftTable = draftTableOf(state, assessment.draftTableId);

    if (draftTable) {
      draftTables.set(tableId, draftTable);
    }
  }

  return draftTables;
}

function invalidRowsOf(
  validatedRows: ReadonlyMap<string, ValidatedRows>,
): Map<string, InvalidRows> {
  const invalidRows = new Map<string, InvalidRows>();

  for (const [tableId, { invalidRows: invalid }] of validatedRows) {
    if (invalid) {
      invalidRows.set(tableId, invalid);
    }
  }

  return invalidRows;
}

function consultedTableVersionIdsOf(
  state: RepairState,
  validatedRows: ReadonlyMap<string, ValidatedRows>,
): string[] {
  return [...validatedRows.values()].flatMap(({ referencedTableIds }) =>
    referencedTableIds.flatMap(
      (tableId) => state.draft.tableVersionIds.get(tableId) ?? [],
    ),
  );
}

function draftTableOf(
  state: RepairState,
  tableId: string,
): DraftTable | undefined {
  const versionId = state.draft.tableVersionIds.get(tableId);
  const stored = state.draft.schemas.get(tableId);

  if (versionId === undefined || !stored) {
    return undefined;
  }

  return { tableId, versionId, schema: stored.schema };
}
