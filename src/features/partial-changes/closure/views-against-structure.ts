import { Injectable } from '@nestjs/common';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { TargetViews } from 'src/features/partial-changes/assembly/system-target-assembler';
import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  blocking,
  type CheckSource,
  type Finding,
  requiring,
  requiringOrDangling,
} from 'src/features/partial-changes/closure/findings';
import { ViewsFit } from 'src/features/partial-changes/closure/views-fit';
import {
  publicTableIdOf,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { ViewValidationService } from 'src/features/views/services';

const REVISION_NAMES: Readonly<Record<RevisionSide, string>> = {
  head: 'Head',
  draft: 'Draft',
};

@Injectable()
export class ViewsAgainstStructure implements TargetCheck {
  constructor(private readonly viewValidation: ViewValidationService) {}

  public checkingOf(source: CheckSource): TargetChecking {
    return new ViewsAgainstStructureChecking(
      source.catalogue.tables,
      new ViewsFit(this.viewValidation, source.snapshot),
    );
  }
}

class ViewsAgainstStructureChecking implements TargetChecking {
  constructor(
    private readonly catalogueTables: CatalogueTables,
    private readonly viewsFit: ViewsFit,
  ) {}

  public async findingsOf(context: CheckContext): Promise<Finding[]> {
    return [
      ...this.viewsWithoutTable(context),
      ...(await this.viewsNotFittingStructure(context)),
    ];
  }

  private viewsWithoutTable(context: CheckContext): Finding[] {
    return context.source.snapshot.tables
      .filter((pair) => !context.tables.contains(pair))
      .flatMap((pair) => this.keepViewsWithTable(context, pair));
  }

  private keepViewsWithTable(
    context: CheckContext,
    pair: TablePair,
  ): Finding[] {
    const { source, rules, names } = context;
    const views = source.catalogue.lookup.tableUnitOf('views', pair)?.key;

    if (views === undefined) {
      return [];
    }

    const viewsSide = rules.sideTakenBy(views);

    if (!this.catalogueTables.viewsRowsOf(pair)[viewsSide]) {
      return [];
    }

    const tableId = publicTableIdOf(pair);

    return [
      requiringOrDangling(this.unappliedTableUnitOf(context, pair), {
        code: 'viewsDoNotFitStructure',
        tableId,
        because: `the ${REVISION_NAMES[viewsSide]} views of ${tableId} belong to a table the ${names.target} does not contain`,
      }),
    ];
  }

  private async viewsNotFittingStructure(
    context: CheckContext,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const views of context.target.views) {
      if (
        this.appliesTableUnitOf(context, views.pair) &&
        !(await this.viewsFit.fits(views))
      ) {
        findings.push(this.fitViews(context, views));
      }
    }

    return findings;
  }

  private fitViews(context: CheckContext, views: TargetViews): Finding {
    const { tableId, pair, tableSide, viewsSide } = views;
    const misfit = `${REVISION_NAMES[viewsSide]} views of ${tableId} do not fit its ${REVISION_NAMES[tableSide]} structure`;
    const unapplied = this.unappliedTableUnitOf(context, pair);

    if (viewsSide === tableSide || unapplied === undefined) {
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

  private appliesTableUnitOf(context: CheckContext, pair: TablePair): boolean {
    return this.tableUnitsOf(context, pair).some((unit) =>
      context.rules.isApplied(unit),
    );
  }

  private unappliedTableUnitOf(
    context: CheckContext,
    pair: TablePair,
  ): string | undefined {
    return this.tableUnitsOf(context, pair).find(
      (unit) => !context.rules.isApplied(unit),
    );
  }

  private tableUnitsOf(context: CheckContext, pair: TablePair): string[] {
    return [
      context.source.catalogue.lookup.tableUnitOf('views', pair)?.key,
      context.structureOf(pair),
    ].filter((unit): unit is string => unit !== undefined);
  }
}
