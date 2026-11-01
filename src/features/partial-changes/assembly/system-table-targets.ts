import type { Row } from 'src/engine-prisma-types';
import {
  oppositeOf,
  type OutcomeRules,
  type RevisionSide,
  type TableOutcome,
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

export interface ViewsRewrite {
  readonly source: Row;
  readonly tableId: string;
  readonly pair: TablePair;
  readonly viewsSide: RevisionSide;
}

export interface SystemTableTarget {
  readonly tableId: SystemTables;
  readonly rows: SystemTableRows;
  readonly linkSide: RevisionSide;
  readonly versions: readonly Row[];
  readonly rewrites: readonly ViewsRewrite[];
  readonly ownerKinds: readonly UnitKind[];
}

interface ViewsOfTable {
  readonly versions: readonly Row[];
  readonly rewrites: readonly ViewsRewrite[];
}

const NO_VIEWS: ViewsOfTable = { versions: [], rewrites: [] };

export function systemTableTargetsOf(
  source: AssemblySource,
  rules: OutcomeRules,
): SystemTableTarget[] {
  return new SystemTableTargets(source, rules).targets();
}

export function systemTableOutcomeOf(
  { rows, linkSide }: SystemTableTarget,
  versions: readonly Row[],
  hasNewRows: boolean,
): TableOutcome {
  const otherSide = oppositeOf(linkSide);
  const onBothSides = rows.versionIds[otherSide] !== undefined;

  if (!onBothSides && versions.length === 0 && !hasNewRows) {
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
    const { schemas, migrations, views, sharedSchemas } =
      this.source.snapshot.systemRows;

    return [
      this.rowsFollowingOwners(SystemTables.Schema, schemas, 'structure'),
      this.rowsFollowingOwners(SystemTables.Migration, migrations, 'structure'),
      this.viewsTarget(views),
      this.rowsFollowingOwners(
        SystemTables.SharedSchemas,
        sharedSchemas,
        'sharedSchema',
      ),
    ].filter(({ rows }) => existsOnEitherSide(rows));
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
      linkSide: this.linkSideOf(rows),
      versions: distinctRows([
        ...rows.head.filter((row) => sideOf(row) === 'head'),
        ...rows.draft.filter((row) => sideOf(row) === 'draft'),
      ]),
      rewrites: [],
      ownerKinds: [kind],
    };
  }

  private viewsTarget(rows: SystemTableRows): SystemTableTarget {
    const views = this.source.snapshot.tables.map((pair) => this.viewsOf(pair));

    return {
      tableId: SystemTables.Views,
      rows,
      linkSide: this.linkSideOf(rows),
      versions: views.flatMap(({ versions }) => versions),
      rewrites: views.flatMap(({ rewrites }) => rewrites),
      ownerKinds: ['structure', 'views'],
    };
  }

  private viewsOf(pair: TablePair): ViewsOfTable {
    const structureSide = this.sideTakenFor(
      this.lookup.tableUnitOf('structure', pair)?.key,
    );
    const viewsSide = this.viewsSideOf(pair, structureSide);
    const table = pair[structureSide];
    const source = this.tables.viewsRowsOf(pair)[viewsSide];

    if (!table || !source) {
      return NO_VIEWS;
    }

    if (viewsSide === structureSide) {
      return { versions: [source], rewrites: [] };
    }

    return {
      versions: [],
      rewrites: [{ source, tableId: table.id, pair, viewsSide }],
    };
  }

  private viewsSideOf(
    pair: TablePair,
    structureSide: RevisionSide,
  ): RevisionSide {
    const viewsUnit = this.lookup.tableUnitOf('views', pair);

    if (!viewsUnit) {
      return structureSide;
    }

    return this.rules.sideTakenBy(viewsUnit.key);
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

function ownersByVersionId(
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
