import { CqrsModule } from '@nestjs/cqrs';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ModuleMetadata, Provider } from '@nestjs/common';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface RevisionChangesTestKit {
  module: TestingModule;
  prismaService: PrismaService;
  close(): Promise<void>;
}

export async function createRevisionChangesTestKit({
  imports = [],
  providers,
}: {
  imports?: NonNullable<ModuleMetadata['imports']>;
  providers: Provider[];
}): Promise<RevisionChangesTestKit> {
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, CqrsModule, ...imports],
    providers,
  }).compile();

  return {
    module,
    prismaService: module.get(PrismaService),
    async close() {
      await module.close();
    },
  };
}
