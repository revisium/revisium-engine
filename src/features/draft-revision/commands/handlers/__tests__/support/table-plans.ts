import objectHash from 'object-hash';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue, Row, Table } from 'src/engine-prisma-types';
import {
  type MixedTableVersion,
  type NewRowVersion,
  oppositeOf,
  type RevisionSide,
  type RowLinkChanges,
  type TableWritePlan,
  type TargetTableVersion,
} from 'src/features/draft-revision/commands/impl';
import type { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';

export interface MergedColumns {
  readonly data?: JsonValue;
  readonly meta?: JsonValue;
}

export interface TargetRows {
  readonly otherSide?: readonly string[];
  readonly absent?: readonly string[];
  readonly merged?: Readonly<Record<string, MergedColumns>>;
}

type TableTargetOutcome = 'unchanged' | 'absent' | 'base' | 'other' | 'mixed';

export interface TableTarget {
  readonly tableId: string;
  readonly outcome: TableTargetOutcome;
  readonly structureSide?: RevisionSide;
  readonly rows?: TargetRows;
  readonly relinkCandidate?: boolean;
  readonly hasFileFields?: boolean;
}

export interface TableVersions {
  readonly head?: Table;
  readonly draft?: Table;
}

export class TablePlans {
  constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly draft: ChangesScenario,
    private readonly baseSide: RevisionSide,
  ) {}

  public async planOf(target: TableTarget): Promise<TableWritePlan> {
    const structureSide = target.structureSide ?? this.baseSide;
    const versions = await this.tableVersionsOf(target.tableId);

    return {
      identity: (versions.draft ?? versions.head)?.createdId ?? target.tableId,
      headVersionId: versions.head?.versionId,
      draftVersionId: versions.draft?.versionId,
      target: await this.targetVersionOf(target, versions, structureSide),
      relinkCandidate: target.relinkCandidate ?? false,
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

  public async tableVersionsOf(tableId: string): Promise<TableVersions> {
    const draft = await this.tableOn('draft', { id: tableId });
    const head = await this.tableOn(
      'head',
      draft ? { createdId: draft.createdId } : { id: tableId },
    );

    return { head, draft };
  }

  public async rowsOf(
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

  private async targetVersionOf(
    target: TableTarget,
    versions: TableVersions,
    structureSide: RevisionSide,
  ): Promise<TargetTableVersion> {
    switch (target.outcome) {
      case 'absent':
        return { kind: 'linked', versionId: undefined };
      case 'unchanged':
      case 'base':
        return {
          kind: 'linked',
          versionId: versions[structureSide]?.versionId,
        };
      case 'other':
        return {
          kind: 'linked',
          versionId: versions[oppositeOf(structureSide)]?.versionId,
        };
      case 'mixed':
        return this.mixedVersionOf(target, versions, structureSide);
    }
  }

  private async mixedVersionOf(
    target: TableTarget,
    versions: TableVersions,
    structureSide: RevisionSide,
  ): Promise<MixedTableVersion> {
    const source = requiredVersion(versions, structureSide);

    return {
      kind: 'mixed',
      tableId: source.id,
      sourceVersionId: source.versionId,
      editInPlace: this.editsDraftInPlace(structureSide, versions.draft),
      hasFileFields: target.hasFileFields ?? false,
      ...(await this.rowLinkChangesOf(
        source,
        versions[oppositeOf(structureSide)],
        target.rows ?? {},
      )),
    };
  }

  private editsDraftInPlace(
    structureSide: RevisionSide,
    draft: Table | undefined,
  ): boolean {
    return (
      this.baseSide === 'draft' &&
      structureSide === 'draft' &&
      draft?.readonly === false
    );
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

function requiredVersion(versions: TableVersions, side: RevisionSide): Table {
  const version = versions[side];

  if (!version) {
    throw new Error(`The table has no ${side} version`);
  }

  return version;
}

export function requiredRow(
  rows: ReadonlyMap<string, Row>,
  rowId: string,
): Row {
  const row = rows.get(rowId);

  if (!row) {
    throw new Error(`Row ${rowId} is not in the table version`);
  }

  return row;
}
