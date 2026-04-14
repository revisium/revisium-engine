import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import {
  RenameTableCommand,
  RenameTableCommandReturnType,
} from 'src/features/draft/commands/impl/rename-table.command';
import { SystemTables } from 'src/features/share/system-tables.consts';

describe('RenameTableHandler', () => {
  const nextTableId = 'nextTableId';
  let kit: DraftTestKit;

  it('should throw an error if the tableId is shorter than 1 character', async () => {
    const { tableId, draftRevisionId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RenameTableCommand({
      revisionId: draftRevisionId,
      tableId,
      nextTableId: '',
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Table ID must be 1 to 64 characters, start with a letter or underscore, and contain only letters (a-z, A-Z), digits (0-9), underscores (_), and hyphens (-).',
    );
  });

  it('should throw an error if the revision does not exist', async () => {
    const { tableId } = await givenDraftProject(kit.prismaService);

    jest
      .spyOn(kit.draftTransactionalCommands, 'resolveDraftRevision')
      .mockRejectedValue(new Error('Revision not found'));

    const command = new RenameTableCommand({
      revisionId: 'unreal',
      tableId,
      nextTableId,
    });

    await expect(runTransaction(command)).rejects.toThrow('Revision not found');
  });

  it('should throw an error if findTableInRevisionOrThrow fails', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    jest
      .spyOn(kit.draftTransactionalCommands, 'resolveDraftRevision')
      .mockRejectedValue(new Error('Table not found'));

    const command = new RenameTableCommand({
      revisionId: draftRevisionId,
      tableId,
      nextTableId,
    });

    await expect(runTransaction(command)).rejects.toThrow('Table not found');
  });

  it('should throw an error if IDs are the same', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RenameTableCommand({
      revisionId: draftRevisionId,
      tableId: tableId,
      nextTableId: tableId,
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'New ID must be different from current',
    );
  });

  it('should throw an error if the table is a system table', async () => {
    const { draftRevisionId } = await givenDraftProject(kit.prismaService);

    const command = new RenameTableCommand({
      revisionId: draftRevisionId,
      tableId: SystemTables.Schema,
      nextTableId,
    });

    await expect(runTransaction(command)).rejects.toThrow(
      'Table is a system table',
    );
  });

  it('should rename the table', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(
      kit.prismaService,
    );

    const command = new RenameTableCommand({
      revisionId: draftRevisionId,
      tableId,
      nextTableId,
    });

    const result = await runTransaction(command);
    expect(result.tableVersionId).toBeTruthy();

    const oldTable = await kit.tableApiService.getTable({
      revisionId: draftRevisionId,
      tableId,
    });
    expect(oldTable).toBeNull();

    const newTable = await kit.tableApiService.getTable({
      revisionId: draftRevisionId,
      tableId: nextTableId,
    });
    expect(newTable).not.toBeNull();
    expect(newTable?.id).toBe(nextTableId);
  });

  function runTransaction(
    command: RenameTableCommand,
  ): Promise<RenameTableCommandReturnType> {
    return kit.transactionService.run(async () =>
      kit.commandBus.execute(command),
    );
  }

  beforeAll(async () => {
    kit = await createTestingModule();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });

  describe('views integration', () => {
    it('should rename views row when renaming table that has views configured', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      const viewsTableVersionId = nanoid();
      await kit.prismaService.table.create({
        data: {
          id: SystemTables.Views,
          versionId: viewsTableVersionId,
          createdId: nanoid(),
          readonly: false,
          system: true,
          revisions: {
            connect: { id: draftRevisionId },
          },
        },
      });

      const viewsRowVersionId = nanoid();
      await kit.prismaService.row.create({
        data: {
          id: tableId,
          versionId: viewsRowVersionId,
          createdId: nanoid(),
          readonly: false,
          data: {
            version: 1,
            defaultViewId: 'default',
            views: [{ id: 'default', name: 'Default' }],
          },
          hash: '',
          schemaHash: '',
          tables: {
            connect: { versionId: viewsTableVersionId },
          },
        },
      });

      const viewsRowBefore = await kit.prismaService.row.findFirst({
        where: {
          id: tableId,
          tables: { some: { versionId: viewsTableVersionId } },
        },
      });
      expect(viewsRowBefore).not.toBeNull();

      const command = new RenameTableCommand({
        revisionId: draftRevisionId,
        tableId,
        nextTableId,
      });
      await runTransaction(command);

      const viewsRowAfterOld = await kit.prismaService.row.findFirst({
        where: {
          id: tableId,
          tables: {
            some: {
              id: SystemTables.Views,
              revisions: { some: { id: draftRevisionId } },
            },
          },
        },
      });
      expect(viewsRowAfterOld).toBeNull();

      const viewsRowAfterNew = await kit.prismaService.row.findFirst({
        where: {
          id: nextTableId,
          tables: {
            some: {
              id: SystemTables.Views,
              revisions: { some: { id: draftRevisionId } },
            },
          },
        },
      });
      expect(viewsRowAfterNew).not.toBeNull();
      expect(viewsRowAfterNew?.data).toEqual({
        version: 1,
        defaultViewId: 'default',
        views: [{ id: 'default', name: 'Default' }],
      });
    });

    it('should not fail when renaming table without views', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      const command = new RenameTableCommand({
        revisionId: draftRevisionId,
        tableId,
        nextTableId,
      });

      await expect(runTransaction(command)).resolves.toBeDefined();
    });

    it('should not fail when views table exists but no views row for table', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      await kit.prismaService.table.create({
        data: {
          id: SystemTables.Views,
          versionId: nanoid(),
          createdId: nanoid(),
          readonly: false,
          system: true,
          revisions: {
            connect: { id: draftRevisionId },
          },
        },
      });

      const command = new RenameTableCommand({
        revisionId: draftRevisionId,
        tableId,
        nextTableId,
      });

      await expect(runTransaction(command)).resolves.toBeDefined();
    });
  });
});
