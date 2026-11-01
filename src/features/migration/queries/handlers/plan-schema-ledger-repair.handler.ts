import { BadRequestException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  type DraftTable,
  DraftRowsValidation,
  type ValidatedRows,
} from 'src/features/migration/ledger-repair/draft-rows-validation';
import {
  RepairLedger,
  type TableAssessment,
} from 'src/features/migration/ledger-repair/repair-ledger';
import { RepairPlanner } from 'src/features/migration/ledger-repair/repair-planner';
import {
  type RepairState,
  RepairStateReader,
} from 'src/features/migration/ledger-repair/repair-state-reader';
import {
  type InvalidRows,
  type PlanSchemaLedgerRepairData,
  PlanSchemaLedgerRepairQuery,
  type SchemaLedgerRepairPlan,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(PlanSchemaLedgerRepairQuery)
export class PlanSchemaLedgerRepairHandler implements IQueryHandler<
  PlanSchemaLedgerRepairQuery,
  SchemaLedgerRepairPlan
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly stateReader: RepairStateReader,
    private readonly draftRows: DraftRowsValidation,
    private readonly schemaStore: JsonSchemaStoreService,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  public execute({
    data,
  }: PlanSchemaLedgerRepairQuery): Promise<SchemaLedgerRepairPlan> {
    return this.transactionRunner.runPlanning(() => this.planRepair(data));
  }

  private async planRepair(
    data: PlanSchemaLedgerRepairData,
  ): Promise<SchemaLedgerRepairPlan> {
    const state = await this.stateReader.readUnlockedBranch(data);
    const ledger = new RepairLedger(state, {
      refs: this.schemaStore.refs,
      validator: this.validator,
    });
    const assessments = assessmentsOf(
      ledger,
      requestedTableIdsOf(state, ledger, data.tableIds),
    );
    const draftTables = validatedDraftTablesOf(state, assessments);
    const validatedRows = await this.validateDraftRows(state, draftTables);
    const planned = new RepairPlanner(ledger, this.validator).plan(
      assessments,
      invalidRowsOf(validatedRows),
    );

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
