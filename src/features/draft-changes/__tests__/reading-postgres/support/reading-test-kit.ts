import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { DraftChangesModule } from 'src/features/draft-changes/draft-changes.module';

export interface ReadingTestKit extends DraftTestKit {
  changes: DraftChangesApiService;
}

export function useReadingTestKit(): () => ReadingTestKit {
  let kit: ReadingTestKit | undefined;

  beforeAll(async () => {
    kit = await createReadingTestKit();
  });
  afterAll(async () => {
    await kit?.close();
  });

  return () => {
    if (!kit) {
      throw new Error('Draft Changes reading test kit is not initialized.');
    }
    return kit;
  };
}

export async function createReadingTestKit(): Promise<ReadingTestKit> {
  const kit = await createDraftTestKit({
    imports: [DraftChangesModule],
    migrationOptions: { workerMode: 'disabled' },
  });

  return {
    ...kit,
    changes: kit.module.get(DraftChangesApiService),
  };
}
