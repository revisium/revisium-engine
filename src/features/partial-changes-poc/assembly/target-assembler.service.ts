import { Injectable } from '@nestjs/common';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import { RowMerger } from 'src/features/partial-changes-poc/assembly/row-merger.service';
import { assembleSystemTables } from 'src/features/partial-changes-poc/assembly/system-target';
import {
  Direction,
  RowOutcome,
  TableOutcome,
  TargetRow,
  TargetState,
  TargetTable,
  ViewsTarget,
} from 'src/features/partial-changes-poc/assembly/target.types';
import {
  CatalogueRow,
  CatalogueTable,
  ChangeCatalogue,
  schemaOfSide,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  Blocker,
  ChangeOperation,
} from 'src/features/partial-changes-poc/partial-changes.types';
import {
  ChangesSnapshot,
  oppositeOf,
  RevisionSide,
  RowVersion,
  sideOf,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import type { TableViewsData } from 'src/features/views/types';

const EMPTY_SCHEMA = {
  type: 'object',
  properties: {},
} as unknown as JsonSchema;

export interface AssemblyInput {
  snapshot: ChangesSnapshot;
  catalogue: ChangeCatalogue;
  operation: ChangeOperation;
  direction: Direction;
  applied: ReadonlySet<string>;
  preferOtherForUnitlessTables: boolean;
}

interface TableContext {
  input: AssemblyInput;
  table: CatalogueTable;
  linkSide: RevisionSide;
  schema: JsonSchema;
  structureDiffers: boolean;
  takesOtherSide: (key: string) => boolean;
  blockers: Blocker[];
}

@Injectable()
export class TargetAssembler {
  constructor(private readonly rowMerger: RowMerger) {}

  async assemble(input: AssemblyInput): Promise<TargetState> {
    const blockers: Blocker[] = [];
    const userTables: TargetTable[] = [];

    for (const table of input.catalogue.tables.values()) {
      if (table.kind !== 'system') {
        userTables.push(await this.assembleUserTable(table, input, blockers));
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
      tables: [...userTables, ...systemTables],
      views,
      blockers,
    };
  }

  private async assembleUserTable(
    table: CatalogueTable,
    input: AssemblyInput,
    blockers: Blocker[],
  ): Promise<TargetTable> {
    if (table.kind === 'whole') {
      return this.assembleWholeTable(table, input);
    }

    const linkSide = this.structureSide(table, input);
    const schema = schemaOfSide(table.pair, linkSide) ?? EMPTY_SCHEMA;
    const context: TableContext = {
      input,
      table,
      linkSide,
      schema,
      structureDiffers: table.pair.structure?.differs ?? false,
      takesOtherSide: (key) =>
        takenFromDraft(input, key) !== (linkSide === 'draft'),
      blockers,
    };

    const rows: TargetRow[] = [];
    for (const row of table.rows.values()) {
      rows.push({ row, outcome: await this.assembleRow(row, context) });
    }

    return {
      table,
      outcome: this.tableOutcome(context, rows),
      linkSide,
      publicId: sideOf(table.pair, linkSide)?.id,
      schema,
      structureSide: linkSide,
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

  private structureSide(
    table: CatalogueTable,
    input: AssemblyInput,
  ): RevisionSide {
    if (!table.structureUnit) {
      return input.direction.base;
    }
    return takenFromDraft(input, table.structureUnit) ? 'draft' : 'head';
  }

  private tableOutcome(context: TableContext, rows: TargetRow[]): TableOutcome {
    const { table, input } = context;
    if (table.kind === 'unchanged') {
      return 'unchanged';
    }

    if (
      !table.structureUnit &&
      table.unitKeys.length === 0 &&
      input.preferOtherForUnitlessTables
    ) {
      return 'other';
    }

    if (rows.every((row) => keepsLinkedRow(row, context.linkSide))) {
      return 'base';
    }

    if (
      !table.structureUnit &&
      table.unitKeys.every((key) => context.takesOtherSide(key)) &&
      rows.every(
        ({ outcome }) => outcome.kind === 'other' || outcome.kind === 'absent',
      )
    ) {
      return 'other';
    }

    return 'mixed';
  }

  private async assembleRow(
    row: CatalogueRow,
    context: TableContext,
  ): Promise<RowOutcome> {
    const base = sideOf(row.pair, context.linkSide);
    const other = sideOf(row.pair, oppositeOf(context.linkSide));

    if (row.existenceUnit && context.takesOtherSide(row.existenceUnit)) {
      return other
        ? this.bringOtherRow(row, other, context)
        : { kind: 'absent' };
    }

    if (!base) {
      return { kind: 'absent' };
    }

    if (!other) {
      return { kind: 'base', version: base };
    }

    return this.mergeRow(row, base, other, context);
  }

  private async bringOtherRow(
    row: CatalogueRow,
    other: RowVersion,
    context: TableContext,
  ): Promise<RowOutcome> {
    if (!context.structureDiffers) {
      return { kind: 'other', version: other };
    }

    const converted = await this.convert(other, context);
    if (!converted) {
      return { kind: 'absent' };
    }
    return this.merged(row, converted, context);
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
    base: RowVersion,
    other: RowVersion,
    context: TableContext,
  ): RowOutcome {
    const renameFlips = Boolean(
      row.renameUnit && context.takesOtherSide(row.renameUnit),
    );
    const paths = [...row.fieldUnits]
      .filter(([, key]) => context.takesOtherSide(key))
      .map(([path]) => path);

    if (!renameFlips && paths.length === 0) {
      return { kind: 'base', version: base };
    }

    const wholeRowFlips =
      (!row.renameUnit || renameFlips) && paths.length === row.fieldUnits.size;
    if (!context.structureDiffers && wholeRowFlips) {
      return { kind: 'other', version: other };
    }

    const merged = this.rowMerger.merge({
      schema: context.schema,
      base,
      other,
      paths,
      takeOtherId: renameFlips,
    });

    if (
      !context.structureDiffers &&
      merged.hash === other.hash &&
      merged.id === other.id
    ) {
      return { kind: 'other', version: other };
    }

    if (merged.hash === base.hash && merged.id === base.id) {
      return { kind: 'base', version: base };
    }

    return this.merged(row, merged, context);
  }

  private merged(
    row: CatalogueRow,
    merged: { id: string; data: Record<string, unknown>; hash: string },
    context: TableContext,
  ): RowOutcome {
    const { direction } = context.input;
    const metaSource =
      sideOf(row.pair, direction.base) ?? sideOf(row.pair, direction.other);
    if (!metaSource) {
      return { kind: 'absent' };
    }

    return {
      kind: 'merged',
      createdId: row.pair.createdId,
      id: merged.id,
      data: merged.data,
      hash: merged.hash,
      schemaHash: objectHash(context.schema),
      metaSource,
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

export function takenFromDraft(
  input: Pick<AssemblyInput, 'operation' | 'applied'>,
  key: string,
): boolean {
  const applied = input.applied.has(key);
  return input.operation === 'commit' ? applied : !applied;
}

function keepsLinkedRow(row: TargetRow, linkSide: RevisionSide): boolean {
  return (
    row.outcome.kind === 'base' ||
    (row.outcome.kind === 'absent' && !sideOf(row.row.pair, linkSide))
  );
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
