import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  BuildDraftChangesCatalogueQueryData,
  DraftChangesCatalogue,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ReadDraftChangesSnapshotQueryData } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { pairSnapshotTables } from 'src/features/draft-changes/catalogue/snapshot-pairs';
import { DraftChangesReadProjection } from 'src/features/draft-changes/reading/projection/draft-changes-read-projection';

export interface PreparedDraftChangesRead {
  catalogue: DraftChangesCatalogue;
}

@Injectable()
export class DraftChangesReadContext {
  constructor(
    private readonly changes: DraftChangesApiService,
    private readonly readProjection: DraftChangesReadProjection,
  ) {}

  async prepare(
    branch: ReadDraftChangesSnapshotQueryData,
  ): Promise<PreparedDraftChangesRead> {
    const snapshot = await this.changes.readSnapshot(branch);
    const schemaProjections = await this.projectSharedTables(snapshot);
    const catalogueInput: BuildDraftChangesCatalogueQueryData = {
      snapshot,
      schemaProjections,
    };
    const catalogueResult = await this.changes.buildCatalogue(catalogueInput);
    if (catalogueResult.status === 'blocked') {
      const details = catalogueResult.blockers
        .map(({ code, message }) => `${code}: ${message}`)
        .join('\n');
      throw new BadRequestException(
        `Draft changes read is blocked. ${details}`,
      );
    }

    return {
      catalogue: await this.readProjection.project({
        ...catalogueInput,
        catalogue: catalogueResult.catalogue,
      }),
    };
  }

  private async projectSharedTables(
    snapshot: Awaited<ReturnType<DraftChangesApiService['readSnapshot']>>,
  ): Promise<BuildDraftChangesCatalogueQueryData['schemaProjections']> {
    const paired = pairSnapshotTables(snapshot);
    if ('blocker' in paired) {
      throw new BadRequestException(paired.blocker);
    }

    const sharedTables = paired.pairs.filter(
      ({ head, draft }) => head !== undefined && draft !== undefined,
    );
    return Promise.all(
      sharedTables.map(async ({ createdId }) => ({
        tableCreatedId: createdId,
        projection: await this.changes.projectSchema({
          snapshot,
          tableCreatedId: createdId,
          operation: 'commit',
          effects: [],
        }),
      })),
    );
  }
}
