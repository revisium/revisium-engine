import type { Type } from '@nestjs/common';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { ViewsApiService } from 'src/features/views/views-api.service';
import type { ChangesApi } from './contract';

export interface ChangesTestKit extends DraftTestKit {
  changes: ChangesApi;
  views: ViewsApiService;
}

export function useChangesTestKit(): () => ChangesTestKit {
  let kit: ChangesTestKit | undefined;

  beforeAll(async () => {
    kit = await createChangesTestKit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await kit?.close();
  });

  return () => {
    if (!kit) {
      throw new Error('Draft Changes test kit has not been initialized.');
    }
    return kit;
  };
}

export async function loadChangesProvider<T>(file: string, name: string) {
  const path = `src/features/draft-changes/${file}`;
  const exports: Record<string, Type<T>> = await import(path);
  const provider = exports[name];
  if (!provider) {
    throw new Error(`Draft Changes provider ${name} is unavailable.`);
  }
  return provider;
}

async function createChangesTestKit(): Promise<ChangesTestKit> {
  const [module, consumer] = await Promise.all([
    loadChangesProvider('draft-changes.module', 'DraftChangesModule'),
    loadChangesProvider<ChangesApi>(
      'draft-changes-consumer.service',
      'DraftChangesConsumer',
    ),
  ]);
  const kit = await createDraftTestKit({
    imports: [module],
    migrationOptions: { workerMode: 'disabled' },
  });
  return {
    ...kit,
    changes: kit.module.get(consumer),
    views: kit.module.get(ViewsApiService),
  };
}
