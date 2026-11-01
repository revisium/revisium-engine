import { Injectable } from '@nestjs/common';
import type { TableWritePlan } from 'src/features/draft-revision/commands/impl/target-write-plan';
import { DiffService } from 'src/features/share/diff.service';

@Injectable()
export class DraftFollowsHead {
  constructor(private readonly diffService: DiffService) {}

  public async versionToLink(
    { relinkCandidate }: TableWritePlan,
    candidateVersionId: string | undefined,
    headVersionId: string | undefined,
  ): Promise<string | undefined> {
    if (
      !relinkCandidate ||
      candidateVersionId === undefined ||
      headVersionId === undefined ||
      candidateVersionId === headVersionId
    ) {
      return candidateVersionId;
    }

    const differs = await this.diffService.hasTableVersionContentDiffs({
      fromTableVersionId: headVersionId,
      toTableVersionId: candidateVersionId,
    });

    if (differs) {
      return candidateVersionId;
    }

    return headVersionId;
  }
}
