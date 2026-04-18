import { Prisma } from 'src/__generated__/client';
import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { EngineApiService } from 'src/engine-api.service';
import {
  createEngineE2eTestKit,
  type EngineE2eTestKit,
} from './engine-api.e2e-helper';

export interface CowEngineE2eTestKit extends EngineE2eTestKit {
  committedRevisionId?: string;
  enableCowMode(): Promise<void>;
  seedProductsTable(): Promise<void>;
}

export async function createCowEngineE2eTestKit(): Promise<CowEngineE2eTestKit> {
  const kit = (await createEngineE2eTestKit()) as CowEngineE2eTestKit;
  const { api, prisma, projectId } = kit;

  kit.enableCowMode = async (): Promise<void> => {
    await prisma.projectVersioningConfig.upsert({
      where: { projectId },
      create: { projectId, versioningMode: 'cow' },
      update: { versioningMode: 'cow' },
    });
  };

  kit.seedProductsTable = async (): Promise<void> => {
    const schema = getObjectSchema({
      name: getStringSchema(),
      price: getNumberSchema(),
    });

    await api.createTable({
      revisionId: kit.draftRevisionId,
      tableId: 'products',
      schema,
    });

    await createProductRow(api, kit.draftRevisionId, 'row-banana', {
      name: 'Banana',
      price: 10,
    });
    await createProductRow(api, kit.draftRevisionId, 'row-apple', {
      name: 'Apple',
      price: 20,
    });
  };

  return kit;
}

async function createProductRow(
  api: EngineApiService,
  revisionId: string,
  rowId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await api.createRow({
    revisionId,
    tableId: 'products',
    rowId,
    data: data as Prisma.InputJsonValue,
  });
}
