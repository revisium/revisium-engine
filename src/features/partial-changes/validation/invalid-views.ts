import { BadRequestException } from '@nestjs/common';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import { OutcomeRules } from 'src/features/partial-changes/assembly/outcome-rules';
import type { TableViews } from 'src/features/partial-changes/assembly/system-table-targets';
import type {
  AssembledTarget,
  AssemblySource,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { AppliedUnits } from 'src/features/partial-changes/plan/change-operation';
import type { CatalogueBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ViewValidationService } from 'src/features/views/services';
import type { TableViewsData } from 'src/features/views/types';

const REVISION_NAMES: Readonly<Record<RevisionSide, string>> = {
  head: 'Head',
  draft: 'Draft',
};

// Views follow the structure (§3.6): a views document comes from the side of its table's structure unit, or the
// table has the same structure on both sides. So a document that fails here does not fit the structure of its own
// side: native damage, never a combination.
export class InvalidViews {
  private readonly rules: OutcomeRules;

  constructor(
    private readonly validation: ViewValidationService,
    private readonly source: AssemblySource,
    choice: AppliedUnits,
  ) {
    this.rules = new OutcomeRules(choice);
  }

  public async of({ views }: AssembledTarget): Promise<CatalogueBlocker[]> {
    const blockers: CatalogueBlocker[] = [];

    for (const target of views.filter((table) => this.changes(table))) {
      if (!(await this.fits(target))) {
        blockers.push(this.invalidViewsOf(target));
      }
    }

    return blockers;
  }

  private changes({ pair, source }: TableViews): boolean {
    const base =
      this.source.catalogue.tables.viewsRowsOf(pair)[this.rules.baseSide];

    return base?.versionId !== source.versionId;
  }

  private async fits({
    tableId,
    viewsSide,
    source,
  }: TableViews): Promise<boolean> {
    const document = source.data as unknown as TableViewsData;

    try {
      await this.validation.validateViewsData(document);
      await this.validation.validateViewsFields(
        this.revisionIdOf(viewsSide),
        tableId,
        document,
      );

      return true;
    } catch (error) {
      if (error instanceof BadRequestException) {
        return false;
      }

      throw error;
    }
  }

  private invalidViewsOf({
    pair,
    tableId,
    viewsSide,
  }: TableViews): CatalogueBlocker {
    const side = REVISION_NAMES[viewsSide];

    return {
      code: 'invalidViews',
      tableId,
      message: `The ${side} views of ${tableId} do not fit its ${side} structure`,
      unitKey: this.ownerOf(pair),
    };
  }

  private ownerOf(pair: TablePair): string | undefined {
    const { lookup } = this.source.catalogue;

    return (
      lookup.tableUnitOf('views', pair) ?? lookup.tableUnitOf('structure', pair)
    )?.key;
  }

  private revisionIdOf(side: RevisionSide): string {
    const { headRevisionId, draftRevisionId } = this.source.snapshot;

    return side === 'head' ? headRevisionId : draftRevisionId;
  }
}
