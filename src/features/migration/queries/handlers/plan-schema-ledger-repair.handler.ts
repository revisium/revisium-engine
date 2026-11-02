import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { LedgerRepairPlanService } from 'src/features/migration/ledger-repair/ledger-repair-plan.service';
import { RepairStateReader } from 'src/features/migration/ledger-repair/repair-state-reader';
import {
  type PlanSchemaLedgerRepairData,
  PlanSchemaLedgerRepairQuery,
  type SchemaLedgerRepairPlan,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(PlanSchemaLedgerRepairQuery)
export class PlanSchemaLedgerRepairHandler implements IQueryHandler<
  PlanSchemaLedgerRepairQuery,
  SchemaLedgerRepairPlan
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly stateReader: RepairStateReader,
    private readonly repairPlanService: LedgerRepairPlanService,
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

    return this.repairPlanService.plan(state, { tableIds: data.tableIds });
  }
}
