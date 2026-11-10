import { BadRequestException } from '@nestjs/common';
import { OutcomeRules } from 'src/features/partial-changes/assembly/outcome-rules';
import type { TableViews } from 'src/features/partial-changes/assembly/system-table-targets';
import type {
  AssembledTarget,
  AssemblySource,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { AppliedUnits } from 'src/features/partial-changes/plan/change-operation';
import type { CatalogueBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import {
  type TablePair,
  versionOn,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ViewValidationService } from 'src/features/views/services';
import type { TableViewsData } from 'src/features/views/types';

// Views follow the structure (§3.6), so a Draft document that a commit publishes and that fails here does not fit
// its own Draft structure: native damage, never a combination. A revert restores published Head documents.
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
    if (this.rules.operation !== 'commit') {
      return [];
    }

    const blockers: CatalogueBlocker[] = [];

    for (const table of views) {
      const owner = this.ownerOf(table.pair);

      if (owner === undefined || !this.rules.isApplied(owner)) {
        continue;
      }

      const failure = await this.failureOf(table);

      if (failure !== undefined) {
        blockers.push(invalidViewsOf(table, owner, failure));
      }
    }

    return blockers;
  }

  private ownerOf(pair: TablePair): string | undefined {
    const { lookup } = this.source.catalogue;

    return (
      lookup.tableUnitOf('views', pair) ?? lookup.tableUnitOf('structure', pair)
    )?.key;
  }

  private async failureOf({
    pair,
    tableId,
    source,
  }: TableViews): Promise<string | undefined> {
    const document = source.data as unknown as TableViewsData;

    try {
      await this.validation.validateViewsData(document);
      this.validation.validateSuppliedSchemaFields(
        tableId,
        document,
        versionOn(pair, 'draft').schema,
      );

      return undefined;
    } catch (error) {
      if (error instanceof BadRequestException) {
        return error.message;
      }

      throw error;
    }
  }
}

function invalidViewsOf(
  { tableId }: TableViews,
  unitKey: string,
  failure: string,
): CatalogueBlocker {
  return {
    code: 'invalidViews',
    tableId,
    message: `The Draft views of ${tableId} are invalid for its Draft structure: ${failure}`,
    unitKey,
  };
}
