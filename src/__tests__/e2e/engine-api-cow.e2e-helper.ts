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
  const baseKit = await createEngineE2eTestKit();
  const { api, prisma, projectId } = baseKit;

  return {
    ...baseKit,
    async enableCowMode(): Promise<void> {
      await prisma.projectVersioningConfig.upsert({
        where: { projectId },
        create: { projectId, versioningMode: 'cow' },
        update: { versioningMode: 'cow' },
      });
    },
    async seedProductsTable(): Promise<void> {
      const schema = getObjectSchema({
        name: getStringSchema(),
        price: getNumberSchema(),
      });
      const getDraftRevisionId = () => baseKit.draftRevisionId;

      await api.createTable({
        revisionId: getDraftRevisionId(),
        tableId: 'products',
        schema,
      });

      await createProductRow(api, getDraftRevisionId(), 'row-banana', {
        name: 'Banana',
        price: 10,
      });
      await createProductRow(api, getDraftRevisionId(), 'row-apple', {
        name: 'Apple',
        price: 20,
      });
    },
  };
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
