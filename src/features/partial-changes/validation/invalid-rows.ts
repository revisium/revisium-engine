import type { ErrorObject } from 'ajv/dist/2020';
import {
  type AppliedUnits,
  OutcomeRules,
} from 'src/features/partial-changes/assembly/outcome-rules';
import { versionOn } from 'src/features/partial-changes/assembly/read-tables';
import type { MergedRow } from 'src/features/partial-changes/assembly/row-merger';
import type {
  AssembledTarget,
  AssemblySource,
  TablePlan,
  TargetRow,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import { sideNamesOf } from 'src/features/partial-changes/closure/findings';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';
import type {
  RowPair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';

interface MergedTargetRow {
  readonly pair: RowPair;
  readonly merged: MergedRow;
}

export class InvalidRows {
  private readonly rules: OutcomeRules;
  private readonly lookup: CatalogueLookup;
  private readonly targetName: string;

  constructor(
    private readonly dataValidator: JsonSchemaValidatorService,
    private readonly source: AssemblySource,
    choice: AppliedUnits,
  ) {
    this.rules = new OutcomeRules(choice);
    this.lookup = new CatalogueLookup(source.catalogue);
    this.targetName = sideNamesOf(choice.operation).target;
  }

  public async of(target: AssembledTarget): Promise<PlanBlocker[]> {
    const blockers: PlanBlocker[] = [];

    for (const plan of target.tables) {
      blockers.push(...(await this.invalidRowsOf(plan)));
    }

    return blockers;
  }

  private async invalidRowsOf(plan: TablePlan): Promise<PlanBlocker[]> {
    const mergedRows = plan.rows.flatMap(mergedRowOf);

    if (mergedRows.length === 0) {
      return [];
    }

    const version = this.targetVersionOf(plan);
    const schemaHash = this.dataValidator.getSchemaHash(version.schema);
    const blockers: PlanBlocker[] = [];

    for (const row of mergedRows) {
      const { result, errors } = await this.dataValidator.validate(
        row.merged.data,
        version.schema,
        schemaHash,
      );

      if (!result) {
        blockers.push(this.invalidRowOf(plan, version, row, errors ?? []));
      }
    }

    return blockers;
  }

  private invalidRowOf(
    plan: TablePlan,
    { id: tableId }: TableVersion,
    { pair, merged }: MergedTargetRow,
    errors: readonly ErrorObject[],
  ): PlanBlocker {
    return {
      code: 'invalidRow',
      tableId,
      rowId: merged.id,
      message: `${tableId}/${merged.id} does not match the schema of the ${this.targetName}: ${detailsOf(errors)}`,
      unitKey: this.unitTakingOtherSideOf(plan, pair),
    };
  }

  private unitTakingOtherSideOf(plan: TablePlan, pair: RowPair): string {
    const [unit] = unitKeysOf(this.catalogueRowOf(plan, pair))
      .filter((key) => this.rules.sideTakenBy(key) !== plan.structureSide)
      .map((key) => this.lookup.unit(key))
      .sort(compareUnits);

    if (!unit) {
      throw new Error(`Row ${pair.identity} was merged without a unit`);
    }

    return unit.key;
  }

  private catalogueRowOf({ identity }: TablePlan, pair: RowPair): CatalogueRow {
    const row = this.source.catalogue.rows
      .get(identity)
      ?.find((candidate) => candidate.pair.identity === pair.identity);

    if (!row) {
      throw new Error(`Row ${pair.identity} is not in the catalogue`);
    }

    return row;
  }

  private targetVersionOf({
    identity,
    structureSide,
  }: TablePlan): TableVersion {
    const pair = this.source.snapshot.tables.find(
      (candidate) => candidate.identity === identity,
    );

    if (!pair) {
      throw new Error(`Table ${identity} is not in the snapshot`);
    }

    return versionOn(pair, structureSide);
  }
}

function mergedRowOf(row: TargetRow): MergedTargetRow[] {
  if (row.kind !== 'merge') {
    return [];
  }

  return [{ pair: row.pair, merged: row.merged }];
}

function unitKeysOf({ existence, columns, leaves }: CatalogueRow): string[] {
  const keys = new Set([...columns.values(), ...leaves.values()]);

  if (existence !== undefined) {
    keys.add(existence);
  }

  return [...keys];
}

function detailsOf(errors: readonly ErrorObject[]): string {
  return errors
    .map(
      ({ instancePath, message }) =>
        `${instancePath || '/'} ${message ?? 'is invalid'}`,
    )
    .join('; ');
}
