import type { JsonValue, Row } from 'src/engine-prisma-types';
import {
  oppositeOf,
  type RevisionSide,
} from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { OutcomeRules } from 'src/features/partial-changes/assembly/outcome-rules';
import { versionOn } from 'src/features/partial-changes/assembly/read-tables';
import type {
  AssembledTarget,
  TablePlan,
  TargetRow,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { CheckSource } from 'src/features/partial-changes/closure/findings';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

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
  public readonly version: TableVersion;
  public readonly tableId: string;
  public readonly loadedIdentities: readonly string[];
  private readonly holdersById = new Map<string, HeldRow[]>();
  private readonly byBaseId: ReadonlyMap<string, CatalogueRow>;
  private readonly byOtherId: ReadonlyMap<string, CatalogueRow>;

  constructor(
    public readonly pair: TablePair,
    public readonly structureSide: RevisionSide,
    public readonly heldRows: readonly HeldRow[],
    private readonly loaded: readonly CatalogueRow[],
    private readonly changedPointers: readonly JsonPointer[],
    private readonly baseSide: RevisionSide,
    public readonly refusal: RefusedTable | undefined,
  ) {
    this.version = versionOn(pair, structureSide);
    this.tableId = this.version.id;
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

  public touchedIds(): string[] {
    return [...new Set([...this.byBaseId.keys(), ...this.byOtherId.keys()])];
  }

  public keepsBaseId(): boolean {
    return this.pair[this.baseSide]?.id === this.tableId;
  }

  public takesOtherSideStructure(): boolean {
    return this.structureSide !== this.baseSide;
  }

  public isChangedField(pointer: JsonPointer): boolean {
    return this.changedPointers.some((changed) => changed.isAtOrAbove(pointer));
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
  private readonly identities: ReadonlySet<string>;
  private readonly pairsById: Readonly<
    Record<RevisionSide, ReadonlyMap<string, TablePair>>
  >;
  private readonly plans: ReadonlyMap<string, TablePlan>;
  private readonly changedPointers: ReadonlyMap<string, readonly JsonPointer[]>;

  constructor(
    private readonly source: CheckSource,
    target: AssembledTarget,
    private readonly rules: OutcomeRules,
    private readonly lookup: CatalogueLookup,
  ) {
    this.plans = new Map(target.tables.map((plan) => [plan.identity, plan]));
    this.changedPointers = new Map(
      source.tables.map(({ identity, structure }) => [
        identity,
        structure.changedPointers,
      ]),
    );
    this.all = source.snapshot.tables.flatMap((pair) =>
      this.targetTablesOf(pair),
    );
    this.byTableId = new Map(this.all.map((table) => [table.tableId, table]));
    this.identities = new Set(this.all.map(({ pair }) => pair.identity));
    this.pairsById = {
      head: pairsByIdOn(source.snapshot.tables, 'head'),
      draft: pairsByIdOn(source.snapshot.tables, 'draft'),
    };
  }

  public named(tableId: string): TargetTable | undefined {
    return this.byTableId.get(tableId);
  }

  public contains({ identity }: TablePair): boolean {
    return this.identities.has(identity);
  }

  public tableMeantBy(
    referrer: TargetTable,
    tableId: string,
  ): TablePair | undefined {
    return this.pairsById[referrer.structureSide].get(tableId);
  }

  public referencedBy(
    referrer: TargetTable,
    tableId: string,
  ): TargetTable | undefined {
    const holder = this.named(tableId);
    const meant = this.tableMeantBy(referrer, tableId);

    if (meant !== undefined && holder?.pair.identity !== meant.identity) {
      return undefined;
    }

    return holder;
  }

  public refusalOfReference(
    referrer: TargetTable,
    tableId: string,
  ): RefusedTable | undefined {
    if (referrer.refusal) {
      return referrer.refusal;
    }

    const meant = this.tableMeantBy(referrer, tableId);

    return meant && this.refusalOf(meant);
  }

  private targetTablesOf(pair: TablePair): TargetTable[] {
    const structureSide = this.rules.structureSideOf(
      this.lookup.tableUnitOf('structure', pair)?.key,
    );

    if (!pair[structureSide]) {
      return [];
    }

    const loaded = this.source.catalogue.rows.get(pair.identity) ?? [];

    return [
      new TargetTable(
        pair,
        structureSide,
        heldRowsOf(this.plans.get(pair.identity), loaded, structureSide),
        loaded,
        this.changedPointers.get(pair.identity) ?? [],
        this.rules.baseSide,
        this.refusalOf(pair),
      ),
    ];
  }

  private refusalOf({ identity }: TablePair): RefusedTable | undefined {
    return this.source.headSchema.refusedTablesByIdentity.get(identity);
  }
}

export function idUnitOf({
  columns,
  existence,
}: CatalogueRow): string | undefined {
  return columns.get('id') ?? existence;
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

function pairsByIdOn(
  pairs: readonly TablePair[],
  side: RevisionSide,
): ReadonlyMap<string, TablePair> {
  const byId = new Map<string, TablePair>();

  for (const pair of pairs) {
    const version = pair[side];

    if (version) {
      byId.set(version.id, pair);
    }
  }

  return byId;
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
