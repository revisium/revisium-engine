import type { JsonValue, Row } from 'src/engine-prisma-types';
import {
  oppositeOf,
  type OutcomeRules,
  type RevisionSide,
} from 'src/features/partial-changes/assembly/outcome-rules';
import { versionOn } from 'src/features/partial-changes/assembly/read-tables';
import type {
  AssembledTarget,
  AssemblySource,
  TablePlan,
  TargetRow,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface HeldRow {
  readonly row: CatalogueRow;
  readonly id: string;
  readonly data: JsonValue;
}

export interface IdCollision {
  readonly id: string;
  readonly rows: readonly HeldRow[];
}

export class TargetTable {
  public readonly tableId: string;
  public readonly loadedIdentities: readonly string[];
  private readonly holdersById = new Map<string, HeldRow[]>();
  private readonly byBaseId: ReadonlyMap<string, CatalogueRow>;
  private readonly byOtherId: ReadonlyMap<string, CatalogueRow>;

  constructor(
    public readonly pair: TablePair,
    public readonly version: TableVersion,
    public readonly heldRows: readonly HeldRow[],
    private readonly loaded: readonly CatalogueRow[],
    private readonly baseSide: RevisionSide,
  ) {
    this.tableId = version.id;
    this.loadedIdentities = loaded.map(({ pair }) => pair.identity);
    this.byBaseId = rowsByIdOn(loaded, baseSide);
    this.byOtherId = rowsByIdOn(loaded, oppositeOf(baseSide));

    for (const held of heldRows) {
      const holders = this.holdersById.get(held.id) ?? [];

      this.holdersById.set(held.id, [...holders, held]);
    }
  }

  public holds(id: string): boolean {
    return this.holdersById.has(id);
  }

  public touches(id: string): boolean {
    return this.byBaseId.has(id) || this.byOtherId.has(id);
  }

  public collisions(): IdCollision[] {
    return [...this.holdersById]
      .filter(([, holders]) => holders.length > 1)
      .map(([id, holders]) => ({ id, rows: holders }));
  }

  public lostIds(): string[] {
    return [...this.byBaseId.keys()].filter((id) => !this.holds(id));
  }

  public losableIds(): string[] {
    return [...this.byBaseId]
      .filter(([, row]) => idUnitOf(row) !== undefined)
      .map(([id]) => id);
  }

  public versionsBroughtBy(unitKey: string, row: CatalogueRow): Row[] {
    const otherSide = oppositeOf(this.baseSide);
    const rows = this.loaded.filter(
      (candidate) => candidate === row || candidate.existence === unitKey,
    );

    return rows.flatMap(({ pair }) => {
      const version = pair[otherSide];

      return version ? [version] : [];
    });
  }

  public providerOf(id: string): string | undefined {
    const row = this.byOtherId.get(id);

    if (!row || row.pair[this.baseSide]?.id === id) {
      return undefined;
    }

    return idUnitOf(row);
  }

  public unitLosing(id: string): string | undefined {
    const row = this.byBaseId.get(id);

    return row && idUnitOf(row);
  }

  public isBroughtWholesale(): boolean {
    return this.pair[this.baseSide] === undefined;
  }
}

export class TargetTables {
  public readonly all: readonly TargetTable[];
  private readonly byTableId: ReadonlyMap<string, TargetTable>;

  constructor(
    source: AssemblySource,
    target: AssembledTarget,
    rules: OutcomeRules,
  ) {
    const plans = new Map(target.tables.map((plan) => [plan.identity, plan]));

    this.all = source.snapshot.tables.flatMap((pair) =>
      targetTablesOf(
        pair,
        plans.get(pair.identity),
        source.catalogue.rows.get(pair.identity) ?? [],
        rules.baseSide,
      ),
    );
    this.byTableId = new Map(this.all.map((table) => [table.tableId, table]));
  }

  public named(tableId: string): TargetTable | undefined {
    return this.byTableId.get(tableId);
  }
}

export function idUnitOf({
  columns,
  existence,
}: CatalogueRow): string | undefined {
  return columns.get('id') ?? existence;
}

function targetTablesOf(
  pair: TablePair,
  plan: TablePlan | undefined,
  loaded: readonly CatalogueRow[],
  baseSide: RevisionSide,
): TargetTable[] {
  const structureSide = plan?.structureSide ?? baseSide;
  const version = pair[structureSide];

  if (!version) {
    return [];
  }

  return [
    new TargetTable(
      pair,
      version,
      heldRowsOf(plan, loaded, structureSide),
      loaded,
      baseSide,
    ),
  ];
}

function heldRowsOf(
  plan: TablePlan | undefined,
  loaded: readonly CatalogueRow[],
  structureSide: RevisionSide,
): HeldRow[] {
  const rows = new Map(loaded.map((row) => [row.pair.identity, row]));

  return (plan?.rows ?? []).flatMap((targetRow) => {
    const row = rows.get(targetRow.pair.identity);
    const version = targetVersionOf(targetRow, structureSide);

    if (!row || !version) {
      return [];
    }

    return [{ row, id: version.id, data: version.data }];
  });
}

function targetVersionOf(
  targetRow: TargetRow,
  structureSide: RevisionSide,
): Pick<Row, 'id' | 'data'> | undefined {
  switch (targetRow.kind) {
    case 'absent':
      return undefined;
    case 'structureSide':
      return versionOn(targetRow.pair, structureSide);
    case 'otherSide':
      return versionOn(targetRow.pair, oppositeOf(structureSide));
    case 'merge':
      return targetRow.merged;
  }
}

function rowsByIdOn(
  rows: readonly CatalogueRow[],
  side: RevisionSide,
): ReadonlyMap<string, CatalogueRow> {
  const byId = new Map<string, CatalogueRow>();

  for (const row of rows) {
    const version = row.pair[side];

    if (version) {
      byId.set(version.id, row);
    }
  }

  return byId;
}
