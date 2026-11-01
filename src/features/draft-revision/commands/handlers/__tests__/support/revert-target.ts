import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  TableWritePlan,
  TargetWritePlan,
} from 'src/features/draft-revision/commands/impl';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import type { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';
import { type TableTarget, TablePlans } from './table-plans';

export class RevertTarget {
  private readonly tablePlans: TablePlans;

  constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly draft: ChangesScenario,
  ) {
    this.tablePlans = new TablePlans(kit, draft, 'draft');
  }

  public async revert(...targets: TableTarget[]): Promise<string> {
    return this.write(await this.plan(...targets));
  }

  public write(plan: TargetWritePlan): Promise<string> {
    return this.runner.runWrite(() => this.api.revertToTarget(plan));
  }

  public async revertInFailingCaller(...targets: TableTarget[]): Promise<void> {
    const plan = await this.plan(...targets);

    await this.runner.runWrite(async () => {
      await this.api.revertToTarget(plan);

      throw new Error('The caller failed after the write');
    });
  }

  public async plan(...targets: TableTarget[]): Promise<TargetWritePlan> {
    const tables: TableWritePlan[] = [];

    for (const target of targets) {
      tables.push(await this.tablePlans.planOf(target));
    }

    return {
      headRevisionId: await this.draft.revisionId('head'),
      draftRevisionId: await this.draft.revisionId('draft'),
      tables,
    };
  }

  public draftOnlyRowIds(tableId: string): Promise<string[]> {
    return this.tablePlans.draftOnlyRowIds(tableId);
  }

  private get runner(): OperationTransactionRunner {
    return this.kit.module.get(OperationTransactionRunner);
  }

  private get api(): DraftRevisionTargetApiService {
    return this.kit.module.get(DraftRevisionTargetApiService);
  }
}
