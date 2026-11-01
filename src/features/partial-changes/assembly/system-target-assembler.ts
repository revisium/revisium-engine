import { Injectable } from '@nestjs/common';
import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import {
  type LinkChanges,
  NO_LINK_CHANGES,
} from 'src/features/partial-changes/assembly/link-changes';
import {
  oppositeOf,
  type OutcomeRules,
  type RevisionSide,
  type TableOutcome,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { MergedRow } from 'src/features/partial-changes/assembly/row-merger';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import {
  CatalogueTables,
  distinctRows,
} from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type {
  SystemTableRows,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import type { TableViewsData } from 'src/features/views/types';
import { HashService } from 'src/infrastructure/database/hash.service';

export interface SystemTablePlan extends LinkChanges {
  readonly tableId: SystemTables;
  readonly outcome: TableOutcome;
  readonly linkSide: RevisionSide;
  readonly versionId?: string;
  readonly relinkCandidate: boolean;
}

interface DesiredRows {
  readonly versions: readonly Row[];
  readonly newRows: readonly MergedRow[];
}

interface SystemTableTarget {
  readonly tableId: SystemTables;
  readonly rows: SystemTableRows;
  readonly desired: DesiredRows;
  readonly ownerKinds: readonly UnitKind[];
}

const NO_ROWS: DesiredRows = { versions: [], newRows: [] };

@Injectable()
export class SystemTargetAssembler {
  private readonly headViews: HeadViewsMigration;

  constructor(
    private readonly hashService: HashService,
    viewsMigration: ViewsMigrationService,
    schemaRules: NativeSchemaRules,
  ) {
    this.headViews = new HeadViewsMigration(viewsMigration, schemaRules);
  }

  public assemble(
    source: AssemblySource,
    rules: OutcomeRules,
  ): Promise<SystemTablePlan[]> {
    return new SystemTargetAssembly(
      source,
      rules,
      this.headViews,
      this.hashService,
    ).planSystemTables();
  }
}

class SystemTargetAssembly {
  private readonly tables: CatalogueTables;
  private readonly lookup: CatalogueLookup;

  constructor(
    private readonly source: AssemblySource,
    private readonly rules: OutcomeRules,
    private readonly headViews: HeadViewsMigration,
    private readonly hashService: HashService,
  ) {
    this.tables = new CatalogueTables(source.snapshot, source.tables);
    this.lookup = new CatalogueLookup(source.catalogue);
  }

  public async planSystemTables(): Promise<SystemTablePlan[]> {
    const { schemas, migrations, views, sharedSchemas } =
      this.source.snapshot.systemRows;
    const targets: SystemTableTarget[] = [
      {
        tableId: SystemTables.Schema,
        rows: schemas,
        desired: this.rowsFollowingOwners(schemas, 'structure'),
        ownerKinds: ['structure'],
      },
      {
        tableId: SystemTables.Migration,
        rows: migrations,
        desired: this.rowsFollowingOwners(migrations, 'structure'),
        ownerKinds: ['structure'],
      },
      {
        tableId: SystemTables.Views,
        rows: views,
        desired: await this.targetViewsRows(),
        ownerKinds: ['structure', 'views'],
      },
      {
        tableId: SystemTables.SharedSchemas,
        rows: sharedSchemas,
        desired: this.rowsFollowingOwners(sharedSchemas, 'sharedSchema'),
        ownerKinds: ['sharedSchema'],
      },
    ];

    return targets
      .filter(({ rows }) => existsOnEitherSide(rows))
      .map((target) => this.planOf(target));
  }

  private rowsFollowingOwners(
    rows: SystemTableRows,
    kind: UnitKind,
  ): DesiredRows {
    const owners = ownersByVersionId(this.source.catalogue.units, kind);
    const sideOf = (row: Row) => this.sideTakenFor(owners.get(row.versionId));

    return {
      versions: distinctRows([
        ...rows.head.filter((row) => sideOf(row) === 'head'),
        ...rows.draft.filter((row) => sideOf(row) === 'draft'),
      ]),
      newRows: [],
    };
  }

  private async targetViewsRows(): Promise<DesiredRows> {
    const targets: DesiredRows[] = [];

    for (const pair of this.source.snapshot.tables) {
      targets.push(await this.targetViewsOf(pair));
    }

    return {
      versions: targets.flatMap(({ versions }) => versions),
      newRows: targets.flatMap(({ newRows }) => newRows),
    };
  }

  private async targetViewsOf(pair: TablePair): Promise<DesiredRows> {
    const structureSide = this.sideTakenFor(
      this.lookup.tableUnitOf('structure', pair)?.key,
    );
    const viewsSide = this.viewsSideOf(pair, structureSide);
    const table = pair[structureSide];
    const views = this.tables.viewsRowsOf(pair)[viewsSide];

    if (!table || !views) {
      return NO_ROWS;
    }

    if (viewsSide === structureSide) {
      return { versions: [views], newRows: [] };
    }

    return this.viewsRowHolding(
      views,
      table.id,
      this.viewsDocumentOn(pair, viewsSide, views),
    );
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

  private viewsDocumentOn(
    pair: TablePair,
    viewsSide: RevisionSide,
    views: Row,
  ): TableViewsData {
    const document = views.data as unknown as TableViewsData;

    if (viewsSide === 'draft' || !pair.head) {
      return document;
    }

    return (
      this.headViews.migrate(
        document,
        pair.head.schema,
        this.tables.structureOf(pair).pendingHistory,
      ) ?? document
    );
  }

  private async viewsRowHolding(
    source: Row,
    tableId: string,
    document: TableViewsData,
  ): Promise<DesiredRows> {
    if (source.id === tableId && deepEqual(source.data, document)) {
      return { versions: [source], newRows: [] };
    }

    const newRow: MergedRow = {
      createdId: source.createdId,
      createdAt: source.createdAt,
      id: tableId,
      data: document as unknown as JsonValue,
      hash: await this.hashService.hashObject(document),
      schemaHash: source.schemaHash,
      publishedAt: source.publishedAt,
      meta: source.meta,
    };

    return { versions: [], newRows: [newRow] };
  }

  private planOf({
    tableId,
    rows,
    desired,
    ownerKinds,
  }: SystemTableTarget): SystemTablePlan {
    const linkSide = this.linkSideOf(rows);
    const outcome = systemTableOutcomeOf(rows, desired, linkSide);

    return {
      tableId,
      outcome,
      linkSide,
      versionId: linkedVersionIdOf(rows, outcome, linkSide),
      ...systemLinkChangesOf(outcome, rows[linkSide], desired),
      relinkCandidate: this.keepsNoUnitsOf(ownerKinds),
    };
  }

  private linkSideOf(rows: SystemTableRows): RevisionSide {
    const { baseSide } = this.rules;

    if (rows.versionIds[baseSide] === undefined) {
      return oppositeOf(baseSide);
    }

    return baseSide;
  }

  private keepsNoUnitsOf(kinds: readonly UnitKind[]): boolean {
    return this.source.catalogue.units
      .filter(({ unit }) => kinds.includes(unit.kind))
      .every(({ key }) => this.rules.isApplied(key));
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

function systemTableOutcomeOf(
  rows: SystemTableRows,
  desired: DesiredRows,
  linkSide: RevisionSide,
): TableOutcome {
  const otherSide = oppositeOf(linkSide);

  if (desired.newRows.length > 0) {
    return 'mixed';
  }

  if (holdsExactly(rows[linkSide], desired.versions)) {
    return 'base';
  }

  if (
    rows.versionIds[otherSide] !== undefined &&
    holdsExactly(rows[otherSide], desired.versions)
  ) {
    return 'other';
  }

  return 'mixed';
}

function systemLinkChangesOf(
  outcome: TableOutcome,
  linked: readonly Row[],
  desired: DesiredRows,
): LinkChanges {
  if (outcome !== 'mixed') {
    return NO_LINK_CHANGES;
  }

  const linkedIds = versionIdsOf(linked);
  const desiredIds = versionIdsOf(desired.versions);

  return {
    removedLinks: [...linkedIds].filter((id) => !desiredIds.has(id)),
    addedLinks: [...desiredIds].filter((id) => !linkedIds.has(id)),
    newRows: desired.newRows,
  };
}

function linkedVersionIdOf(
  rows: SystemTableRows,
  outcome: TableOutcome,
  linkSide: RevisionSide,
): string | undefined {
  if (outcome === 'other') {
    return rows.versionIds[oppositeOf(linkSide)];
  }

  return rows.versionIds[linkSide];
}

function holdsExactly(rows: readonly Row[], versions: readonly Row[]): boolean {
  const versionIds = versionIdsOf(versions);

  return (
    rows.length === versionIds.size &&
    rows.every(({ versionId }) => versionIds.has(versionId))
  );
}

function versionIdsOf(rows: readonly Row[]): Set<string> {
  return new Set(rows.map(({ versionId }) => versionId));
}

function existsOnEitherSide({ versionIds }: SystemTableRows): boolean {
  return versionIds.head !== undefined || versionIds.draft !== undefined;
}
