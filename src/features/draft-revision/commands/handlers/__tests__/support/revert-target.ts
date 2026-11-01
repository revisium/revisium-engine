import objectHash from 'object-hash';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue, Row, Table } from 'src/engine-prisma-types';
import type {
  NewRowVersion,
  RevisionSide,
  RowLinkChanges,
  TableWriteOutcome,
  TableWritePlan,
  TargetWritePlan,
} from 'src/features/draft-revision/commands/impl';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import type { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

export interface MergedColumns {
  readonly data?: JsonValue;
  readonly meta?: JsonValue;
}

export interface TargetRows {
  readonly otherSide?: readonly string[];
  readonly absent?: readonly string[];
  readonly merged?: Readonly<Record<string, MergedColumns>>;
}

export interface TableTarget {
  readonly tableId: string;
  readonly outcome: TableWriteOutcome;
  readonly structureSide?: RevisionSide;
  readonly rows?: TargetRows;
  readonly relinkCandidate?: boolean;
  readonly hasFileFields?: boolean;
}

interface TableVersions {
  readonly head?: Table;
  readonly draft?: Table;
}

export class RevertTarget {
  constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly draft: ChangesScenario,
  ) {}

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
      tables.push(await this.tablePlanOf(target));
    }

    return {
      headRevisionId: await this.draft.revisionId('head'),
      draftRevisionId: await this.draft.revisionId('draft'),
      tables,
    };
  }

  public async draftOnlyRowIds(tableId: string): Promise<string[]> {
    const { head, draft } = await this.tableVersionsOf(tableId);
    const headRows = await this.rowsOf(head);
    const draftRows = await this.rowsOf(draft);

    return [...draftRows.values()]
      .filter((row) => headRows.get(row.id)?.versionId !== row.versionId)
      .map((row) => row.id);
  }

  private async tablePlanOf(target: TableTarget): Promise<TableWritePlan> {
    const structureSide = target.structureSide ?? 'draft';
    const versions = await this.tableVersionsOf(target.tableId);

    return {
      identity: (versions.draft ?? versions.head)?.createdId ?? target.tableId,
      headVersionId: versions.head?.versionId,
      draftVersionId: versions.draft?.versionId,
      outcome: target.outcome,
      structureSide,
      ...(await this.rowLinkChangesOf(
        versions[structureSide],
        versions[oppositeOf(structureSide)],
        target.rows ?? {},
      )),
      relinkCandidate: target.relinkCandidate ?? false,
      hasFileFields: target.hasFileFields ?? false,
    };
  }

  private async rowLinkChangesOf(
    structureVersion: Table | undefined,
    otherVersion: Table | undefined,
    { otherSide = [], absent = [], merged = {} }: TargetRows,
  ): Promise<RowLinkChanges> {
    const structureRows = await this.rowsOf(structureVersion);
    const otherRows = await this.rowsOf(otherVersion);
    const replaced = [...otherSide, ...absent, ...Object.keys(merged)];

    return {
      removedRowVersionIds: replaced.flatMap((rowId) =>
        versionIdsOf(structureRows.get(rowId)),
      ),
      addedRowVersionIds: otherSide.map(
        (rowId) => requiredRow(otherRows, rowId).versionId,
      ),
      newRows: Object.entries(merged).map(([rowId, columns]) =>
        newRowVersionOf(
          structureRows.get(rowId) ?? requiredRow(otherRows, rowId),
          columns,
        ),
      ),
    };
  }

  private async tableVersionsOf(tableId: string): Promise<TableVersions> {
    const draft = await this.tableOn('draft', { id: tableId });
    const head = await this.tableOn(
      'head',
      draft ? { createdId: draft.createdId } : { id: tableId },
    );

    return { head, draft };
  }

  private async tableOn(
    side: RevisionSide,
    where: { id: string } | { createdId: string },
  ): Promise<Table | undefined> {
    const table = await this.kit.prisma.table.findFirst({
      where: {
        ...where,
        revisions: { some: { id: await this.draft.revisionId(side) } },
      },
    });

    return table ?? undefined;
  }

  private async rowsOf(
    table: Table | undefined,
  ): Promise<ReadonlyMap<string, Row>> {
    if (!table) {
      return new Map();
    }

    const rows = await this.kit.prisma.row.findMany({
      where: { tables: { some: { versionId: table.versionId } } },
    });

    return new Map(rows.map((row) => [row.id, row]));
  }

  private get runner(): OperationTransactionRunner {
    return this.kit.module.get(OperationTransactionRunner);
  }

  private get api(): DraftRevisionTargetApiService {
    return this.kit.module.get(DraftRevisionTargetApiService);
  }
}

function newRowVersionOf(row: Row, columns: MergedColumns): NewRowVersion {
  return {
    createdId: row.createdId,
    createdAt: row.createdAt,
    id: row.id,
    data: columns.data ?? row.data,
    hash: columns.data === undefined ? row.hash : objectHash(columns.data),
    schemaHash: row.schemaHash,
    publishedAt: row.publishedAt,
    meta: columns.meta ?? row.meta,
  };
}

function versionIdsOf(row: Row | undefined): string[] {
  if (!row) {
    return [];
  }

  return [row.versionId];
}

function requiredRow(rows: ReadonlyMap<string, Row>, rowId: string): Row {
  const row = rows.get(rowId);

  if (!row) {
    throw new Error(`Row ${rowId} is not on the other side`);
  }

  return row;
}

function oppositeOf(side: RevisionSide): RevisionSide {
  if (side === 'head') {
    return 'draft';
  }

  return 'head';
}
