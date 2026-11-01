import type { Row } from 'src/engine-prisma-types';
import {
  oppositeOf,
  type RevisionSide,
} from 'src/features/draft-revision/commands/impl/target-write-plan';
import type {
  OutcomeRules,
  TableOutcome,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import {
  CatalogueTables,
  distinctRows,
} from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type {
  SystemTableRows,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface TableViews {
  readonly pair: TablePair;
  readonly tableId: string;
  readonly tableSide: RevisionSide;
  readonly viewsSide: RevisionSide;
  readonly source: Row;
}

export interface SystemTableTarget {
  readonly tableId: SystemTables;
  readonly rows: SystemTableRows;
  readonly linkSide: RevisionSide;
  readonly keptWhenEmpty: boolean;
  readonly versions: readonly Row[];
  readonly rewrites: readonly TableViews[];
  readonly ownerKinds: readonly UnitKind[];
}

export function systemTableTargetsOf(
  source: AssemblySource,
  rules: OutcomeRules,
): SystemTableTarget[] {
  return new SystemTableTargets(source, rules).targets();
}

export function targetLedgerRowsOf(
  source: AssemblySource,
  rules: OutcomeRules,
): readonly Row[] {
  return new SystemTableTargets(source, rules).ledgerTarget().versions;
}

export function tableViewsOf(
  source: AssemblySource,
  rules: OutcomeRules,
): TableViews[] {
  return new SystemTableTargets(source, rules).tableViews();
}

export function systemTableOutcomeOf(
  { rows, linkSide, keptWhenEmpty }: SystemTableTarget,
  versions: readonly Row[],
  hasNewRows: boolean,
): TableOutcome {
  const otherSide = oppositeOf(linkSide);
  const onBothSides = rows.versionIds[otherSide] !== undefined;

  if (!onBothSides && !keptWhenEmpty && versions.length === 0 && !hasNewRows) {
    return 'absent';
  }

  if (hasNewRows) {
    return 'mixed';
  }

  if (holdsExactly(rows[linkSide], versions)) {
    return 'base';
  }

  if (onBothSides && holdsExactly(rows[otherSide], versions)) {
    return 'other';
  }

  return 'mixed';
}

class SystemTableTargets {
  private readonly tables: CatalogueTables;
  private readonly lookup: CatalogueLookup;

  constructor(
    private readonly source: AssemblySource,
    private readonly rules: OutcomeRules,
  ) {
    this.tables = new CatalogueTables(source.snapshot, source.tables);
    this.lookup = new CatalogueLookup(source.catalogue);
  }

  public targets(): SystemTableTarget[] {
    const { schemas, views, sharedSchemas } = this.source.snapshot.systemRows;

    return [
      this.rowsFollowingOwners(SystemTables.Schema, schemas, 'structure'),
      this.ledgerTarget(),
      this.viewsTarget(views),
      this.rowsFollowingOwners(
        SystemTables.SharedSchemas,
        sharedSchemas,
        'sharedSchema',
      ),
    ].filter(({ rows }) => existsOnEitherSide(rows));
  }

  public ledgerTarget(): SystemTableTarget {
    return this.rowsFollowingOwners(
      SystemTables.Migration,
      this.source.snapshot.systemRows.migrations,
      'structure',
    );
  }

  public tableViews(): TableViews[] {
    return this.source.snapshot.tables.flatMap((pair) =>
      this.tableViewsOf(pair),
    );
  }

  private rowsFollowingOwners(
    tableId: SystemTables,
    rows: SystemTableRows,
    kind: UnitKind,
  ): SystemTableTarget {
    const owners = ownersByVersionId(this.source.catalogue.units, kind);
    const sideOf = (row: Row) => this.sideTakenFor(owners.get(row.versionId));

    return {
      tableId,
      rows,
      ...this.linkOf(rows),
      versions: distinctRows([
        ...rows.head.filter((row) => sideOf(row) === 'head'),
        ...rows.draft.filter((row) => sideOf(row) === 'draft'),
      ]),
      rewrites: [],
      ownerKinds: [kind],
    };
  }

  private viewsTarget(rows: SystemTableRows): SystemTableTarget {
    const views = this.tableViews();

    return {
      tableId: SystemTables.Views,
      rows,
      ...this.linkOf(rows),
      versions: views.filter(followsStructure).map(({ source }) => source),
      rewrites: views.filter((table) => !followsStructure(table)),
      ownerKinds: ['structure', 'views'],
    };
  }

  private tableViewsOf(pair: TablePair): TableViews[] {
    const tableSide = this.sideTakenFor(
      this.lookup.tableUnitOf('structure', pair)?.key,
    );
    const viewsSide = this.viewsSideOf(pair, tableSide);
    const table = pair[tableSide];
    const source = this.tables.viewsRowsOf(pair)[viewsSide];

    if (!table || !source) {
      return [];
    }

    return [{ pair, tableId: table.id, tableSide, viewsSide, source }];
  }

  private viewsSideOf(pair: TablePair, tableSide: RevisionSide): RevisionSide {
    const viewsUnit = this.lookup.tableUnitOf('views', pair);

    if (!viewsUnit) {
      return tableSide;
    }

    return this.rules.sideTakenBy(viewsUnit.key);
  }

  private linkOf(
    rows: SystemTableRows,
  ): Pick<SystemTableTarget, 'linkSide' | 'keptWhenEmpty'> {
    const linkSide = this.linkSideOf(rows);

    return { linkSide, keptWhenEmpty: this.rules.takesEveryTableOf(linkSide) };
  }

  private linkSideOf(rows: SystemTableRows): RevisionSide {
    const { baseSide } = this.rules;

    if (rows.versionIds[baseSide] === undefined) {
      return oppositeOf(baseSide);
    }

    return baseSide;
  }

  private sideTakenFor(owner: string | undefined): RevisionSide {
    if (owner === undefined) {
      return this.rules.unitlessSide;
    }

    return this.rules.sideTakenBy(owner);
  }
}

export function ownersByVersionId(
  units: readonly CatalogueUnit[],
  kind: UnitKind,
): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();

  for (const { key, unit, systemRows } of units) {
    if (unit.kind === kind) {
      for (const { versionId } of systemRows) {
        owners.set(versionId, key);
      }
    }
  }

  return owners;
}

function followsStructure({ tableSide, viewsSide }: TableViews): boolean {
  return viewsSide === tableSide;
}

function holdsExactly(rows: readonly Row[], versions: readonly Row[]): boolean {
  const versionIds = new Set(versions.map(({ versionId }) => versionId));

  return (
    rows.length === versionIds.size &&
    rows.every(({ versionId }) => versionIds.has(versionId))
  );
}

function existsOnEitherSide({ versionIds }: SystemTableRows): boolean {
  return versionIds.head !== undefined || versionIds.draft !== undefined;
}
