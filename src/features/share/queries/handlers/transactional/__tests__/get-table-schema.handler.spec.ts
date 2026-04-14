import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type { QueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { createQueryTestKit } from 'src/__tests__/kit/create-query-test-kit';
import { metaSchema } from 'src/features/share/schema/meta-schema';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

describe('GetTableSchemaHandler', () => {
  describe('system tables', () => {
    it('should return schema for system table without row in revisium_schema_table', async () => {
      const { draftRevisionId } = await givenDraftProject(prismaService);

      const result = await shareTransactionalQueries.getTableSchema(
        draftRevisionId,
        SystemTables.Schema,
      );

      expect(result.schema).toEqual(metaSchema);
    });
  });

  let kit: QueryTestKit;
  let prismaService: PrismaService;
  let shareTransactionalQueries: ShareTransactionalQueries;

  beforeAll(async () => {
    kit = await createQueryTestKit();
    prismaService = kit.prismaService;
    shareTransactionalQueries = kit.shareTransactionalQueries;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });
});
