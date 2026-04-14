import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { createStorageMock } from 'src/__tests__/kit/storage.mock';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import { EngineApiService } from 'src/engine-api.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';

export interface EngineE2eTestKit {
  module: TestingModule;
  api: EngineApiService;
  prisma: PrismaService;
  storageMock: ReturnType<typeof createStorageMock>;
  projectId: string;
  branchId: string;
  branchName: string;
  draftRevisionId: string;
  refreshDraftRevisionId(): Promise<string>;
  revertDraftChanges(): Promise<void>;
  close(): Promise<void>;
}

export async function createEngineE2eTestKit(): Promise<EngineE2eTestKit> {
  const storageMock = createStorageMock();
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot()],
  })
    .overrideProvider(STORAGE_SERVICE)
    .useValue(storageMock)
    .compile();

  await module.init();

  const api = module.get(EngineApiService);
  const prisma = module.get(PrismaService);
  const project = await prepareProject(prisma);

  const kit: EngineE2eTestKit = {
    module,
    api,
    prisma,
    storageMock,
    projectId: project.projectId,
    branchId: project.branchId,
    branchName: project.branchName,
    draftRevisionId: project.draftRevisionId,
    async refreshDraftRevisionId(): Promise<string> {
      const branch = await prisma.branch.findUnique({
        where: { id: kit.branchId },
        include: {
          revisions: { where: { isDraft: true } },
        },
      });
      const draftRevision = branch?.revisions[0];

      if (draftRevision) {
        kit.draftRevisionId = draftRevision.id;
      }

      return kit.draftRevisionId;
    },
    async revertDraftChanges(): Promise<void> {
      try {
        await api.revertChanges({
          projectId: kit.projectId,
          branchName: kit.branchName,
        });
      } catch {
        // no draft changes to revert
      }

      await kit.refreshDraftRevisionId();
    },
    async close(): Promise<void> {
      await module.close();
    },
  };

  return kit;
}
