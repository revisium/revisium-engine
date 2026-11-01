import { Injectable } from '@nestjs/common';
import {
  type AppliedUnits,
  OutcomeRules,
  type RevisionSide,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { TargetViews } from 'src/features/partial-changes/assembly/system-target-assembler';
import type { AssembledTarget } from 'src/features/partial-changes/assembly/target-assembler';
import {
  CatalogueTables,
  publicTableIdOf,
} from 'src/features/partial-changes/catalogue/catalogue-tables';
import {
  blocking,
  type CheckSource,
  danglingInSource,
  type Finding,
  refusedBy,
  requiring,
  requiringOrDangling,
  type SideNames,
  sideNamesOf,
  type TargetCheck,
  type TargetChecking,
} from 'src/features/partial-changes/closure/findings';
import {
  type ForeignKeyLeaf,
  TableSchemas,
} from 'src/features/partial-changes/closure/table-schemas';
import {
  type TargetTable,
  TargetTables,
} from 'src/features/partial-changes/closure/target-tables';
import { UnresolvedReferences } from 'src/features/partial-changes/closure/unresolved-references';
import { ViewsFit } from 'src/features/partial-changes/closure/views-fit';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { ViewValidationService } from 'src/features/views/services';

interface OperationContext {
  readonly source: CheckSource;
  readonly lookup: CatalogueLookup;
  readonly catalogueTables: CatalogueTables;
  readonly schemas: TableSchemas;
  readonly viewsFit: ViewsFit;
  readonly references: UnresolvedReferences;
}

interface WholesaleRowsScan {
  readonly referrer: TargetTable;
  readonly jsonPath: string;
  readonly referenced: TargetTable;
}

const REVISION_NAMES: Readonly<Record<RevisionSide, string>> = {
  head: 'Head',
  draft: 'Draft',
};

@Injectable()
export class StructureChecks implements TargetCheck {
  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly schemaStore: JsonSchemaStoreService,
    private readonly viewValidation: ViewValidationService,
  ) {}

  public checkingOf(source: CheckSource): TargetChecking {
    return new StructureChecking({
      source,
      lookup: new CatalogueLookup(source.catalogue),
      catalogueTables: new CatalogueTables(source.snapshot, source.tables),
      schemas: new TableSchemas(this.schemaStore),
      viewsFit: new ViewsFit(this.viewValidation, source.snapshot),
      references: new UnresolvedReferences(this.snapshotReader),
    });
  }
}

class StructureChecking implements TargetChecking {
  constructor(private readonly context: OperationContext) {}

  public findingsOf(
    target: AssembledTarget,
    choice: AppliedUnits,
  ): Promise<Finding[]> {
    const rules = new OutcomeRules(choice);
    const tables = new TargetTables(
      this.context.source,
      target,
      rules,
      this.context.lookup,
    );

    return new TargetStructureChecks(
      this.context,
      tables,
      target.views,
      rules,
    ).findings();
  }
}

class TargetStructureChecks {
  private readonly names: SideNames;

  constructor(
    private readonly context: OperationContext,
    private readonly tables: TargetTables,
    private readonly views: readonly TargetViews[],
    private readonly rules: OutcomeRules,
  ) {
    this.names = sideNamesOf(rules.operation);
  }

  public async findings(): Promise<Finding[]> {
    return [
      ...this.tableIdCollisions(),
      ...this.brokenTableReferences(),
      ...this.viewsWithoutTable(),
      ...(await this.viewsNotFittingStructure()),
      ...(await this.danglingReferencesOfWholesaleRows()),
    ];
  }

  private tableIdCollisions(): Finding[] {
    return [...holdersByTableId(this.tables.all).values()]
      .filter((holders) => holders.length > 1)
      .flatMap((holders) =>
        holders
          .filter((table) => this.keepsBaseId(table))
          .map((table) => this.moveFromOccupiedId(table)),
      );
  }

  private keepsBaseId(table: TargetTable): boolean {
    const structure = this.structureOf(table.pair);

    return (
      table.keepsBaseId() &&
      (structure === undefined || !this.rules.isApplied(structure))
    );
  }

  private moveFromOccupiedId({ tableId, pair, refusal }: TargetTable): Finding {
    if (refusal) {
      return refusedBy(refusal);
    }

    return requiringOrDangling(this.structureOf(pair), {
      code: 'idOccupied',
      tableId,
      because: `the table id ${tableId} would be held by two tables in the ${this.names.target}`,
    });
  }

  private brokenTableReferences(): Finding[] {
    return this.tables.all.flatMap((referrer) =>
      this.context.schemas
        .referencedTablesOf(referrer.version)
        .filter((tableId) => !this.tables.referencedBy(referrer, tableId))
        .map((tableId) => this.restoreTableReference(referrer, tableId)),
    );
  }

  private restoreTableReference(
    referrer: TargetTable,
    tableId: string,
  ): Finding {
    const structure = this.structureOf(referrer.pair);
    const tableIdSite = { tableId: referrer.tableId };

    if (structure !== undefined && !this.rules.isApplied(structure)) {
      return requiring(structure, {
        ...tableIdSite,
        code: 'referrerStillReferences',
        because: this.brokenReference(
          referrer,
          tableId,
          `which the ${this.names.target} no longer contains`,
        ),
      });
    }

    const provider = this.unappliedStructureMeantBy(referrer, tableId);

    if (provider !== undefined) {
      return requiring(provider, {
        ...tableIdSite,
        code: 'referencedTableMissing',
        because: this.brokenReference(
          referrer,
          tableId,
          `which exists only in ${this.names.other}`,
        ),
      });
    }

    const refusal = this.tables.refusalOfReference(referrer, tableId);

    if (refusal) {
      return refusedBy(refusal);
    }

    return blocking(
      danglingInSource(
        this.brokenReference(
          referrer,
          tableId,
          `which the ${this.names.target} does not contain`,
        ),
        tableIdSite,
        structure,
      ),
    );
  }

  private brokenReference(
    referrer: TargetTable,
    tableId: string,
    whichWhenMissing: string,
  ): string {
    const reference = `the schema of ${referrer.tableId} references the table ${tableId}`;

    if (this.tables.named(tableId) !== undefined) {
      return `${reference}, which is another table in the ${this.names.target}`;
    }

    return `${reference}, ${whichWhenMissing}`;
  }

  private unappliedStructureMeantBy(
    referrer: TargetTable,
    tableId: string,
  ): string | undefined {
    const meant = this.tables.tableMeantBy(referrer, tableId);
    const structure = meant && this.structureOf(meant);

    if (structure === undefined || this.rules.isApplied(structure)) {
      return undefined;
    }

    return structure;
  }

  private viewsWithoutTable(): Finding[] {
    return this.context.source.snapshot.tables
      .filter((pair) => !this.tables.contains(pair))
      .flatMap((pair) => this.keepViewsWithTable(pair));
  }

  private keepViewsWithTable(pair: TablePair): Finding[] {
    const views = this.context.lookup.tableUnitOf('views', pair)?.key;

    if (views === undefined) {
      return [];
    }

    const viewsSide = this.rules.sideTakenBy(views);

    if (!this.context.catalogueTables.viewsRowsOf(pair)[viewsSide]) {
      return [];
    }

    const tableId = publicTableIdOf(pair);
    const unapplied = this.tableUnitsOf(pair).find(
      (unit) => !this.rules.isApplied(unit),
    );

    return [
      requiringOrDangling(unapplied, {
        code: 'viewsDoNotFitStructure',
        tableId,
        because: `the ${REVISION_NAMES[viewsSide]} views of ${tableId} belong to a table the ${this.names.target} does not contain`,
      }),
    ];
  }

  private async viewsNotFittingStructure(): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const views of this.views) {
      if (
        this.appliesTableUnitOf(views.pair) &&
        !(await this.context.viewsFit.fits(views))
      ) {
        findings.push(this.fitViews(views));
      }
    }

    return findings;
  }

  private appliesTableUnitOf(pair: TablePair): boolean {
    return this.tableUnitsOf(pair).some((unit) => this.rules.isApplied(unit));
  }

  private fitViews(views: TargetViews): Finding {
    const { tableId, pair, structureSide, viewsSide } = views;
    const misfit = `${REVISION_NAMES[viewsSide]} views of ${tableId} do not fit its ${REVISION_NAMES[structureSide]} structure`;
    const unapplied = this.tableUnitsOf(pair).find(
      (unit) => !this.rules.isApplied(unit),
    );

    if (viewsSide === structureSide || unapplied === undefined) {
      return blocking({
        code: 'invalidViews',
        tableId,
        message: `The ${misfit}`,
      });
    }

    return requiring(unapplied, {
      code: 'viewsDoNotFitStructure',
      tableId,
      because: `the ${misfit}`,
    });
  }

  private tableUnitsOf(pair: TablePair): string[] {
    return [
      this.context.lookup.tableUnitOf('views', pair)?.key,
      this.structureOf(pair),
    ].filter((unit): unit is string => unit !== undefined);
  }

  private async danglingReferencesOfWholesaleRows(): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const scan of this.wholesaleRowsScans()) {
      const unresolved = await this.context.references.from(
        scan.referrer,
        scan.jsonPath,
        scan.referenced,
      );

      for (const { referencedId, rowId } of unresolved) {
        if (!scan.referenced.holds(referencedId)) {
          findings.push(this.bringReferencedRow(scan, referencedId, rowId));
        }
      }
    }

    return findings;
  }

  private wholesaleRowsScans(): WholesaleRowsScan[] {
    return this.tables.all
      .filter((table) => table.takesOtherSideStructure())
      .flatMap((referrer) =>
        this.context.schemas
          .referencedTablesOf(referrer.version)
          .flatMap((tableId) => this.scansOf(referrer, tableId)),
      );
  }

  private scansOf(referrer: TargetTable, tableId: string): WholesaleRowsScan[] {
    const referenced = this.tables.referencedBy(referrer, tableId);

    if (!referenced) {
      return [];
    }

    return this.foreignKeysBroughtWholesale(referrer, tableId).map(
      ({ jsonPath }) => ({ referrer, jsonPath, referenced }),
    );
  }

  private foreignKeysBroughtWholesale(
    referrer: TargetTable,
    tableId: string,
  ): ForeignKeyLeaf[] {
    const leaves = this.context.schemas.foreignKeyLeavesOf(
      referrer.version,
      tableId,
    );

    if (referrer.isBroughtWholesale()) {
      return leaves;
    }

    return leaves.filter(({ pointer }) => referrer.isChangedField(pointer));
  }

  private bringReferencedRow(
    { referrer, referenced }: WholesaleRowsScan,
    referencedId: string,
    rowId: string,
  ): Finding {
    const site = { tableId: referrer.tableId, rowId };
    const reference = `${referrer.tableId}/${rowId} references ${referenced.tableId}/${referencedId}`;
    const provider = referenced.providerOf(referencedId);

    if (provider !== undefined) {
      return requiring(provider, {
        ...site,
        code: 'referencedRowMissing',
        because: `${reference}, which exists only in ${this.names.other}`,
      });
    }

    if (referenced.refusal) {
      return refusedBy(referenced.refusal);
    }

    return blocking(
      danglingInSource(
        `${reference}, which the ${this.names.target} does not contain`,
        site,
        this.structureOf(referrer.pair),
      ),
    );
  }

  private structureOf(pair: TablePair): string | undefined {
    return this.context.lookup.tableUnitOf('structure', pair)?.key;
  }
}

function holdersByTableId(
  tables: readonly TargetTable[],
): Map<string, TargetTable[]> {
  const holders = new Map<string, TargetTable[]>();

  for (const table of tables) {
    holders.set(table.tableId, [...(holders.get(table.tableId) ?? []), table]);
  }

  return holders;
}
