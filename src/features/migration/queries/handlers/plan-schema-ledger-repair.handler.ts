import { BadRequestException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  type DraftTable,
  DraftRowsValidation,
} from 'src/features/migration/ledger-repair/draft-rows-validation';
import {
  RepairLedger,
  type TableAssessment,
} from 'src/features/migration/ledger-repair/repair-ledger';
import { planDecidedRepairs } from 'src/features/migration/ledger-repair/repair-planner';
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
    const validatedTables = validatedDraftTablesOf(state, assessments);
    const invalidRows = await this.findInvalidRows(state, validatedTables);
    const planned = planDecidedRepairs(assessments, invalidRows);

    return {
      headRevisionId: state.headRevisionId,
      draftRevisionId: state.draftRevisionId,
      tables: planned.tables,
      renumbered: planned.renumbered,
      fingerprint: await this.draftRows.fingerprintOf(
        [...validatedTables.values()],
        state.draft.tableVersionIds,
      ),
    };
  }

  private async findInvalidRows(
    state: RepairState,
    validatedTables: ReadonlyMap<string, DraftTable>,
  ): Promise<Map<string, InvalidRows>> {
    const invalidRows = new Map<string, InvalidRows>();

    for (const [tableId, draftTable] of validatedTables) {
      const invalid = await this.draftRows.findInvalidRows(
        state.draftRevisionId,
        draftTable,
      );

      if (invalid) {
        invalidRows.set(tableId, invalid);
      }
    }

    return invalidRows;
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
