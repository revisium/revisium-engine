import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { DraftChangesModule } from 'src/features/draft-changes/draft-changes.module';
import type { ResolveCandidateViewsResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import { createCandidateViewCatalogue } from './candidate-view-catalogue';
import { createCandidateViewCorruption } from './candidate-view-corruption';
import { createCandidateViewPipeline } from './candidate-view-pipeline';
import {
  givenNativeViewFixture,
  type NativeViewFixture,
} from './native-view-fixture';
import type { CandidateViewCatalogue } from './candidate-view-catalogue';
import type { CandidateViewCorruption } from './candidate-view-corruption';
import type { CandidateViewPipeline } from './candidate-view-pipeline';

export type { PreparedCandidateViewInput } from './candidate-view-pipeline';

export interface CandidateViewScenario
  extends
    NativeViewFixture,
    CandidateViewCatalogue,
    CandidateViewPipeline,
    CandidateViewCorruption {}

export function requireProjected(
  result:
    | ResolveCandidateViewsResult
    | { status: 'viewEntryMissing' }
    | { status: 'schemaEntryMissing' },
): Extract<ResolveCandidateViewsResult, { status: 'projected' }> {
  if (result.status !== 'projected') {
    throw new Error(
      `Expected projected views, received ${JSON.stringify(result)}.`,
    );
  }
  return result;
}

export function requireNeedsEffects(
  result: ResolveCandidateViewsResult,
): Extract<ResolveCandidateViewsResult, { status: 'needsEffects' }> {
  if (result.status !== 'needsEffects') {
    throw new Error(
      `Expected view prerequisites, received ${JSON.stringify(result)}.`,
    );
  }
  return result;
}

export function requireCatalogueEntry<T>(entry: T | undefined): T {
  if (!entry) {
    throw new Error('Expected the native catalogue entry.');
  }
  return entry;
}

export async function createCandidateViewScenario(): Promise<CandidateViewScenario> {
  const kit = await createDraftTestKit({
    imports: [DraftChangesModule],
    migrationOptions: { workerMode: 'disabled' },
  });
  const changes = kit.module.get(DraftChangesApiService);
  const native = await givenNativeViewFixture(kit, changes);
  const catalogue = createCandidateViewCatalogue({
    changes,
    readSnapshot: native.readSnapshot,
  });
  const pipeline = createCandidateViewPipeline({
    changes,
    readSnapshot: native.readSnapshot,
    catalogue,
  });
  const corruption = createCandidateViewCorruption({
    readSnapshot: native.readSnapshot,
    updateDraftSchema: native.updateDraftSchema,
    prismaService: kit.prismaService,
    restoreHeadFromSnapshot: pipeline.restoreHeadFromSnapshot,
    catalogueFromSnapshot: catalogue.catalogueFromSnapshot,
  });

  return {
    ...native,
    ...catalogue,
    ...pipeline,
    ...corruption,
  };
}
