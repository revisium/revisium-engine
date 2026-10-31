import type { InjectionToken, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface DatabaseServiceTestKit {
  module: TestingModule;
  prismaService: PrismaService;
  transactionService: TransactionPrismaService;
  close(): Promise<void>;
}

export interface ProviderOverride {
  provide: InjectionToken;
  useValue: unknown;
}

export async function createDatabaseServiceTestKit(
  providers: Provider[],
  settings: Record<string, string> = {},
  overrides: ProviderOverride[] = [],
): Promise<DatabaseServiceTestKit> {
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => settings] }),
      DatabaseModule,
    ],
    providers,
  });

  for (const { provide, useValue } of overrides) {
    builder.overrideProvider(provide).useValue(useValue);
  }

  const module = await builder.compile();

  await module.init();

  return {
    module,
    prismaService: module.get(PrismaService),
    transactionService: module.get(TransactionPrismaService),
    async close() {
      await module.close();
    },
  };
}
