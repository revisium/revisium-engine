import { Injectable } from '@nestjs/common';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import {
  OutcomeInput,
  planRow,
  tableOutcomeOf,
  planTable,
  RowFlips,
  settledOutcome,
  TablePlan,
  takenFromDraft,
} from 'src/features/partial-changes-poc/assembly/outcome-plan';
import { RowMerger } from 'src/features/partial-changes-poc/assembly/row-merger.service';
import { assembleSystemTables } from 'src/features/partial-changes-poc/assembly/system-target';
import {
  RowOutcome,
  TargetRow,
  TargetState,
  TargetTable,
  ViewsTarget,
} from 'src/features/partial-changes-poc/assembly/target.types';
import {
  CatalogueRow,
  CatalogueTable,
  schemaOfSide,
  toPublicUnit,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  columnsOf,
  RowColumn,
  RowColumns,
  sameColumns,
} from 'src/features/partial-changes-poc/catalogue/row-columns';
import {
  Blocker,
  DeferredValues,
} from 'src/features/partial-changes-poc/partial-changes.types';
import {
  ChangesSnapshot,
  RevisionSide,
  RowVersion,
  sideOf,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import type { TableViewsData } from 'src/features/views/types';

const EMPTY_SCHEMA = {
  type: 'object',
  properties: {},
} as unknown as JsonSchema;

export interface AssemblyInput extends OutcomeInput {
  snapshot: ChangesSnapshot;
}

interface TableContext extends TablePlan {
  input: AssemblyInput;
  table: CatalogueTable;
  schema: JsonSchema;
  schemaHash: string;
  blockers: Blocker[];
  deferred: DeferredValues[];
}

@Injectable()
export class TargetAssembler {
  constructor(private readonly rowMerger: RowMerger) {}

  async assemble(input: AssemblyInput): Promise<TargetState> {
    const blockers: Blocker[] = [];
    const deferred: DeferredValues[] = [];
    const userTables: TargetTable[] = [];

    for (const table of input.catalogue.tables.values()) {
      if (table.kind !== 'system') {
        userTables.push(
          await this.assembleUserTable(table, input, { blockers, deferred }),
        );
      }
    }

    const views = this.assembleViews(userTables, input);
    const systemTables = assembleSystemTables({
      ...input,
      takenFromDraft: (key) => takenFromDraft(input, key),
      userTables,
      views,
    });

    return {
      operation: input.operation,
      direction: input.direction,
      tables: [...userTables, ...systemTables].map((target) =>
        settleRemainingUnits(target, input),
      ),
      views,
      blockers,
      deferred,
    };
  }

  private async assembleUserTable(
    table: CatalogueTable,
    input: AssemblyInput,
    findings: { blockers: Blocker[]; deferred: DeferredValues[] },
  ): Promise<TargetTable> {
    if (table.kind === 'whole') {
      return this.assembleWholeTable(table, input);
    }

    const plan = planTable(table, input);
    const schema = schemaOfSide(table.pair, plan.linkSide) ?? EMPTY_SCHEMA;
    const context: TableContext = {
      ...plan,
      input,
      table,
      schema,
      schemaHash: objectHash(schema),
      ...findings,
    };

    const rows: TargetRow[] = [];
    for (const row of table.rows.values()) {
      rows.push({ row, outcome: await this.assembleRow(row, context) });
    }

    return {
      table,
      outcome: tableOutcomeOf(
        table,
        plan,
        rows.map(({ row, outcome }) => ({ row, kind: outcome.kind })),
      ),
      linkSide: plan.linkSide,
      publicId: sideOf(table.pair, plan.linkSide)?.id,
      schema,
      structureSide: plan.linkSide,
      rows,
    };
  }

  private assembleWholeTable(
    table: CatalogueTable,
    input: AssemblyInput,
  ): TargetTable {
    const side: RevisionSide = table.pair.draft ? 'draft' : 'head';
    const fromDraft = takenFromDraft(input, table.structureUnit ?? '');
    const present = side === 'draft' ? fromDraft : !fromDraft;

    return {
      table,
      outcome: present ? 'base' : 'absent',
      linkSide: side,
      publicId: present ? sideOf(table.pair, side)?.id : undefined,
      schema: present ? schemaOfSide(table.pair, side) : undefined,
      structureSide: side,
      rows: [],
    };
  }

  private async assembleRow(
    row: CatalogueRow,
    context: TableContext,
  ): Promise<RowOutcome> {
    const plan = planRow(row, context);
    switch (plan.kind) {
      case 'convert':
        return this.convertOtherRow(row, plan.other, context);
      case 'merge':
        return this.mergeRow(row, plan, context);
      default:
        return plan;
    }
  }

  private async convertOtherRow(
    row: CatalogueRow,
    other: RowVersion,
    context: TableContext,
  ): Promise<RowOutcome> {
    const converted = await this.convert(other, context);
    if (!converted) {
      return { kind: 'absent' };
    }
    this.recordDeferredValues(row, context);
    return this.merged(row, converted, context, columnsOf(other));
  }

  private recordDeferredValues(row: CatalogueRow, context: TableContext): void {
    const { table, input, linkSide } = context;
    const paths = table.pair.structure?.draftChangedValuePointers ?? [];
    const unit = input.catalogue.units.get(row.existenceUnit ?? '');
    const structure = input.catalogue.units.get(table.structureUnit ?? '');
    if (
      input.operation !== 'commit' ||
      linkSide !== 'head' ||
      paths.length === 0 ||
      !unit ||
      !structure
    ) {
      return;
    }

    context.deferred.push({
      unit: toPublicUnit(unit),
      paths,
      structure: toPublicUnit(structure),
    });
  }

  private async convert(other: RowVersion, context: TableContext) {
    const { table, input, linkSide, schema } = context;
    const structure = table.pair.structure;
    const conversion = {
      revisionId: input.snapshot.draftRevisionId,
      tableId: table.tableId,
      targetSchema: schema,
    };

    if (linkSide === 'head') {
      return this.rowMerger.mapToHeadStructure(other, table.leaves, conversion);
    }

    if (!structure?.recorded || !structure.pendingHistory) {
      context.blockers.push(unrecordedBlocker(table.tableId));
      return undefined;
    }

    return this.rowMerger.migrateToDraftStructure(
      other,
      structure.pendingHistory,
      table.pair.headSchema ?? EMPTY_SCHEMA,
      conversion,
    );
  }

  private mergeRow(
    row: CatalogueRow,
    { base, other, renameFlips, paths, columns }: RowFlips,
    context: TableContext,
  ): RowOutcome {
    const merged = this.rowMerger.merge({
      schema: context.schema,
      base,
      other,
      paths,
      takeOtherId: renameFlips,
    });
    const mergedColumns = takeColumns(base, other, columns);

    if (
      !context.structureDiffers &&
      merged.hash === other.hash &&
      merged.id === other.id &&
      sameColumns(mergedColumns, other)
    ) {
      return { kind: 'other', version: other };
    }

    if (
      merged.hash === base.hash &&
      merged.id === base.id &&
      sameColumns(mergedColumns, base)
    ) {
      return { kind: 'base', version: base };
    }

    return this.merged(row, merged, context, mergedColumns);
  }

  private merged(
    row: CatalogueRow,
    merged: { id: string; data: Record<string, unknown>; hash: string },
    context: TableContext,
    columns: RowColumns,
  ): RowOutcome {
    return {
      kind: 'merged',
      createdId: row.pair.createdId,
      id: merged.id,
      data: merged.data,
      hash: merged.hash,
      schemaHash: context.schemaHash,
      columns,
    };
  }

  private assembleViews(
    userTables: TargetTable[],
    input: AssemblyInput,
  ): ViewsTarget[] {
    return userTables.flatMap((target) => {
      const views = input.catalogue.views.get(target.table.pair.createdId);
      if (!views || target.outcome === 'absent' || !target.publicId) {
        return [];
      }

      const structureSide = target.structureSide ?? input.direction.base;
      const viewsSide = target.table.viewsUnit
        ? sideFor(input, target.table.viewsUnit)
        : structureSide;

      return [
        {
          table: target.table,
          publicId: target.publicId,
          viewsSide,
          structureSide,
          doc: viewsDocument(views, viewsSide, structureSide),
        },
      ];
    });
  }
}

function takeColumns(
  base: RowVersion,
  other: RowVersion,
  flipped: readonly RowColumn[],
): RowColumns {
  const columns = columnsOf(base);
  if (flipped.includes('publishedAt')) {
    columns.publishedAt = other.publishedAt;
  }
  if (flipped.includes('meta')) {
    columns.meta = other.meta;
  }
  return columns;
}

function settleRemainingUnits(
  target: TargetTable,
  input: AssemblyInput,
): TargetTable {
  return {
    ...target,
    ...settledOutcome(target.table, target.outcome, target.linkSide, input),
  };
}

function sideFor(input: AssemblyInput, key: string): RevisionSide {
  return takenFromDraft(input, key) ? 'draft' : 'head';
}

function viewsDocument(
  views: {
    head?: RowVersion;
    draft?: RowVersion;
    migratedHead?: TableViewsData;
  },
  viewsSide: RevisionSide,
  structureSide: RevisionSide,
): TableViewsData | undefined {
  if (viewsSide === 'draft') {
    return views.draft?.data as TableViewsData | undefined;
  }
  if (structureSide === 'draft' && views.migratedHead) {
    return views.migratedHead;
  }
  return views.head?.data as TableViewsData | undefined;
}

function unrecordedBlocker(tableId: string): Blocker {
  return {
    code: 'unrecordedStructureChange',
    tableId,
    message: `The Draft structure of ${tableId} is not recorded by its schema history and migrations (for example after an async table migration); Head rows cannot be migrated to it`,
  };
}
