import { BadRequestException } from '@nestjs/common';
import type { RevisionSide } from 'src/features/partial-changes/assembly/outcome-rules';
import type { TargetViews } from 'src/features/partial-changes/assembly/system-target-assembler';
import type { BranchRevisions } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ViewValidationService } from 'src/features/views/services';

export class ViewsFit {
  private readonly checks = new Map<string, Promise<boolean>>();

  constructor(
    private readonly validation: ViewValidationService,
    private readonly revisions: BranchRevisions,
  ) {}

  public fits(views: TargetViews): Promise<boolean> {
    const { pair, structureSide, viewsSide } = views;
    const key = JSON.stringify([pair.identity, structureSide, viewsSide]);
    const cached = this.checks.get(key);

    if (cached) {
      return cached;
    }

    const check = this.validate(views);
    this.checks.set(key, check);

    return check;
  }

  private async validate({
    tableId,
    structureSide,
    document,
  }: TargetViews): Promise<boolean> {
    try {
      await this.validation.validateViewsData(document);
      await this.validation.validateViewsFields(
        this.revisionIdOf(structureSide),
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

  private revisionIdOf(side: RevisionSide): string {
    if (side === 'head') {
      return this.revisions.headRevisionId;
    }

    return this.revisions.draftRevisionId;
  }
}
