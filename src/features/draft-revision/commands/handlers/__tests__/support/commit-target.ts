import objectHash from 'object-hash';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { type JsonValue, type Row, sql } from 'src/engine-prisma-types';
import type {
  CommitTableWritePlan,
  CommitTargetWritePlan,
  DraftRevisionCommitToTargetCommandReturnType,
  NewRowVersion,
  RenumberedRows,
  RevisionSide,
} from 'src/features/draft-revision/commands/impl';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import type { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';
import { requiredRow, type TableTarget, TablePlans } from './table-plans';

export interface CommitTableTarget extends TableTarget {
  readonly renumbered?: Readonly<Record<string, string>>;
}

export type CommitResult = DraftRevisionCommitToTargetCommandReturnType;

export interface RowTableWork {
  readonly rowsRead: number;
  readonly rowsUpdated: number;
}

export class CommitTarget {
  private readonly tablePlans: TablePlans;

  constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly draft: ChangesScenario,
  ) {
    this.tablePlans = new TablePlans(kit, draft, 'head');
  }

  public async commit(...targets: CommitTableTarget[]): Promise<CommitResult> {
    return this.write(await this.plan(...targets));
  }

  public write(plan: CommitTargetWritePlan): Promise<CommitResult> {
    return this.runner.runWrite(() => this.api.commitToTarget(plan));
  }

  public rowTableWorkOf(plan: CommitTargetWritePlan): Promise<RowTableWork> {
    return this.runner.runWrite(async () => {
      const before = await this.rowTableWorkSoFar();

      await this.api.commitToTarget(plan);

      return workBetween(before, await this.rowTableWorkSoFar());
    });
  }

  public async commitInFailingCaller(
    ...targets: CommitTableTarget[]
  ): Promise<void> {
    const plan = await this.plan(...targets);

    await this.runner.runWrite(async () => {
      await this.api.commitToTarget(plan);

      throw new Error('The caller failed after the write');
    });
  }

  public async plan(
    ...targets: CommitTableTarget[]
  ): Promise<CommitTargetWritePlan> {
    const tables: CommitTableWritePlan[] = [];

    for (const target of targets) {
      tables.push(await this.tablePlanOf(target));
    }

    return this.planOf(tables);
  }

  public async wholeDraftPlan(): Promise<CommitTargetWritePlan> {
    const head = await this.linkedTableVersionsOf('head');
    const draft = await this.linkedTableVersionsOf('draft');
    const identities = new Set([...head.keys(), ...draft.keys()]);

    return this.planOf(
      [...identities].map((identity) =>
        takeDraftVersion(identity, head.get(identity), draft.get(identity)),
      ),
    );
  }

  public draftOnlyRowIds(tableId: string): Promise<string[]> {
    return this.tablePlans.draftOnlyRowIds(tableId);
  }

  private async planOf(
    tables: readonly CommitTableWritePlan[],
  ): Promise<CommitTargetWritePlan> {
    return {
      branchId: this.draft.branchId,
      headRevisionId: await this.draft.revisionId('head'),
      draftRevisionId: await this.draft.revisionId('draft'),
      tables,
    };
  }

  private async tablePlanOf(
    target: CommitTableTarget,
  ): Promise<CommitTableWritePlan> {
    const plan = await this.tablePlans.planOf(target);

    if (target.renumbered === undefined) {
      return plan;
    }

    return {
      ...plan,
      renumberedRows: await this.renumberedRowsOf(
        target.tableId,
        target.renumbered,
      ),
    };
  }

  private async renumberedRowsOf(
    tableId: string,
    renumbered: Readonly<Record<string, string>>,
  ): Promise<RenumberedRows> {
    const { draft } = await this.tablePlans.tableVersionsOf(tableId);
    const rows = await this.tablePlans.rowsOf(draft);
    const renumberings = Object.entries(renumbered).map(([rowId, id]) => ({
      source: requiredRow(rows, rowId),
      id,
    }));

    return {
      replacedRowVersionIds: renumberings.map(({ source }) => source.versionId),
      newRows: renumberings.map(({ source, id }) =>
        renumberedRowOf(source, id),
      ),
    };
  }

  private async rowTableWorkSoFar(): Promise<RowTableWork> {
    const [work] = await this.kit.transactionService.getTransaction().$queryRaw<
      RowTableWork[]
    >(sql`
        SELECT (seq_tup_read + coalesce(idx_tup_fetch, 0))::int AS "rowsRead",
               n_tup_upd::int AS "rowsUpdated"
        FROM pg_stat_xact_user_tables
        WHERE relid = '"Row"'::regclass
      `);

    if (!work) {
      throw new Error('The Row table has no transaction statistics');
    }

    return work;
  }

  private async linkedTableVersionsOf(
    side: RevisionSide,
  ): Promise<ReadonlyMap<string, string>> {
    const tables = await this.kit.prisma.table.findMany({
      where: { revisions: { some: { id: await this.draft.revisionId(side) } } },
      select: { createdId: true, versionId: true },
    });

    return new Map(tables.map((table) => [table.createdId, table.versionId]));
  }

  private get runner(): OperationTransactionRunner {
    return this.kit.module.get(OperationTransactionRunner);
  }

  private get api(): DraftRevisionTargetApiService {
    return this.kit.module.get(DraftRevisionTargetApiService);
  }
}

function workBetween(before: RowTableWork, after: RowTableWork): RowTableWork {
  return {
    rowsRead: after.rowsRead - before.rowsRead,
    rowsUpdated: after.rowsUpdated - before.rowsUpdated,
  };
}

function takeDraftVersion(
  identity: string,
  headVersionId: string | undefined,
  draftVersionId: string | undefined,
): CommitTableWritePlan {
  return {
    identity,
    headVersionId,
    draftVersionId,
    outcome: draftVersionId === undefined ? 'absent' : 'base',
    structureSide: 'draft',
    removedRowVersionIds: [],
    addedRowVersionIds: [],
    newRows: [],
    relinkCandidate: true,
    hasFileFields: false,
  };
}

function renumberedRowOf(row: Row, id: string): NewRowVersion {
  const data = { ...(row.data as Record<string, JsonValue>), id };

  return {
    createdId: row.createdId,
    createdAt: row.createdAt,
    id,
    data,
    hash: objectHash(data),
    schemaHash: row.schemaHash,
    publishedAt: new Date(id),
    meta: row.meta,
  };
}
