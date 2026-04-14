import { DiffService } from 'src/features/share/diff.service';
import { GetRevisionChangesQuery } from '../../impl/get-revision-changes.query';
import { GetRevisionChangesHandler } from '../get-revision-changes.handler';
import { RevisionComparisonService } from '../../../services/revision-comparison.service';
import { createRevisionChangesTestKit } from 'src/features/revision-changes/__tests__/revision-changes-test-kit';
import {
  createBranch,
  createRevision,
  createRevisionPair,
  createRevisionTriple,
  createRowVersion,
  createTableVersion,
} from 'src/features/revision-changes/__tests__/revision-changes.fixtures';

describe('GetRevisionChangesHandler', () => {
  describe('execute', () => {
    it('returns empty stats for revision without parent', async () => {
      const { revision } = await prepareRevisionWithoutParent();

      const result = await handler.execute(
        new GetRevisionChangesQuery({
          revisionId: revision.id,
        }),
      );

      expect(result).toEqual({
        revisionId: revision.id,
        parentRevisionId: null,
        totalChanges: 0,
        tablesSummary: {
          total: 0,
          added: 0,
          modified: 0,
          removed: 0,
          renamed: 0,
        },
        rowsSummary: {
          total: 0,
          added: 0,
          modified: 0,
          removed: 0,
          renamed: 0,
        },
      });
    });

    it('detects and counts renamed and modified changes without double-counting', async () => {
      const { toRevision } = await prepareRenamedAndModifiedChanges();

      const result = await handler.execute(
        new GetRevisionChangesQuery({
          revisionId: toRevision.id,
        }),
      );

      expect(result.tablesSummary.total).toBe(6);
      expect(result.tablesSummary.renamed).toBe(2);
      expect(result.tablesSummary.modified).toBe(4);
      expect(result.tablesSummary.added).toBe(1);
      expect(result.tablesSummary.removed).toBe(1);

      expect(result.rowsSummary.total).toBe(5);
      expect(result.rowsSummary.renamed).toBe(2);
      expect(result.rowsSummary.modified).toBe(2);
      expect(result.rowsSummary.added).toBe(1);
      expect(result.rowsSummary.removed).toBe(1);
    });

    it('returns stats for revision with changes', async () => {
      const { fromRevision, toRevision } = await prepareRevisionsWithChanges();

      const result = await handler.execute(
        new GetRevisionChangesQuery({
          revisionId: toRevision.id,
        }),
      );

      expect(result.revisionId).toBe(toRevision.id);
      expect(result.parentRevisionId).toBe(fromRevision.id);
      expect(result.totalChanges).toBeGreaterThan(0);
      expect(result.tablesSummary.total).toBeGreaterThan(0);
    });

    it('compares with specified revision', async () => {
      const { revision1, revision3 } = await prepareMultipleRevisions();

      const result = await handler.execute(
        new GetRevisionChangesQuery({
          revisionId: revision3.id,
          compareWithRevisionId: revision1.id,
        }),
      );

      expect(result.revisionId).toBe(revision3.id);
      expect(result.parentRevisionId).toBe(revision1.id);
    });

    it('excludes system tables by default', async () => {
      const { toRevision } = await prepareRevisionsWithSystemTables();

      const result = await handler.execute(
        new GetRevisionChangesQuery({
          revisionId: toRevision.id,
        }),
      );

      expect(result.tablesSummary.total).toBe(1);
    });

    it('includes system tables when includeSystem is true', async () => {
      const { toRevision } = await prepareRevisionsWithSystemTables();

      const result = await handler.execute(
        new GetRevisionChangesQuery({
          revisionId: toRevision.id,
          includeSystem: true,
        }),
      );

      expect(result.tablesSummary.total).toBe(2);
    });

    it('calculates correct stats for complex changes', async () => {
      const { toRevision } = await prepareComplexChanges();

      const result = await handler.execute(
        new GetRevisionChangesQuery({
          revisionId: toRevision.id,
        }),
      );

      expect(result.tablesSummary.added).toBeGreaterThan(0);
      expect(result.tablesSummary.removed).toBeGreaterThan(0);
      expect(result.tablesSummary.modified).toBeGreaterThan(0);
      expect(result.rowsSummary.added).toBeGreaterThan(0);
    });
  });

  async function prepareRevisionWithoutParent() {
    const branch = await createBranch(kit.prismaService);
    const revision = await createRevision(kit.prismaService, branch.id);

    return { revision };
  }

  async function prepareRevisionsWithChanges() {
    const { fromRevision, toRevision } = await createRevisionPair(
      kit.prismaService,
    );

    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
    });

    return { fromRevision, toRevision };
  }

  async function prepareMultipleRevisions() {
    return createRevisionTriple(kit.prismaService);
  }

  async function prepareRevisionsWithSystemTables() {
    const { fromRevision, toRevision } = await createRevisionPair(
      kit.prismaService,
    );

    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      system: true,
    });
    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      system: false,
    });

    return { fromRevision, toRevision };
  }

  async function prepareComplexChanges() {
    const { fromRevision, toRevision } = await createRevisionPair(
      kit.prismaService,
    );

    const addedTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
    });

    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
    });

    const modifiedFrom = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
    });
    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      id: modifiedFrom.id,
      createdId: modifiedFrom.createdId,
    });

    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: addedTable.versionId,
    });

    return { fromRevision, toRevision };
  }

  async function prepareRenamedAndModifiedChanges() {
    const { fromRevision, toRevision } = await createRevisionPair(
      kit.prismaService,
    );

    const addedTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
    });

    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
    });

    const modifiedTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
    });
    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      id: modifiedTable.id,
      createdId: modifiedTable.createdId,
    });

    const renamedAndModifiedTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
    });
    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      createdId: renamedAndModifiedTable.createdId,
    });

    const renamedTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
    });
    await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      createdId: renamedTable.createdId,
    });

    const commonTableFrom = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
    });
    const commonTableTo = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      id: commonTableFrom.id,
      createdId: commonTableFrom.createdId,
    });

    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: addedTable.versionId,
      data: { value: 'added' },
    });

    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: commonTableFrom.versionId,
      data: { value: 'removed' },
    });

    const sameRowId = 'same-row';
    const sameRowCreatedId = 'same-row-created';
    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: commonTableFrom.versionId,
      id: sameRowId,
      createdId: sameRowCreatedId,
      data: { value: 'old' },
      hash: 'hash1',
      schemaHash: 'schema1',
    });
    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: commonTableTo.versionId,
      id: sameRowId,
      createdId: sameRowCreatedId,
      data: { value: 'new' },
      hash: 'hash2',
      schemaHash: 'schema1',
    });

    const renamedRowCreatedId = 'renamed-row-created';
    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: commonTableFrom.versionId,
      createdId: renamedRowCreatedId,
      data: { value: 'unchanged' },
      hash: 'sameHash123',
      schemaHash: 'sameSchemaHash456',
    });
    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: commonTableTo.versionId,
      createdId: renamedRowCreatedId,
      data: { value: 'unchanged' },
      hash: 'sameHash123',
      schemaHash: 'sameSchemaHash456',
    });

    const renamedAndModifiedRowCreatedId = 'renamed-modified-row-created';
    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: commonTableFrom.versionId,
      createdId: renamedAndModifiedRowCreatedId,
      data: { value: 'old' },
      hash: 'oldHash',
      schemaHash: 'schema1',
    });
    await createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId: commonTableTo.versionId,
      createdId: renamedAndModifiedRowCreatedId,
      data: { value: 'new' },
      hash: 'newHash',
      schemaHash: 'schema1',
    });

    return { fromRevision, toRevision };
  }

  let kit: Awaited<ReturnType<typeof createRevisionChangesTestKit>>;
  let handler: GetRevisionChangesHandler;

  beforeAll(async () => {
    kit = await createRevisionChangesTestKit({
      providers: [
        GetRevisionChangesHandler,
        DiffService,
        RevisionComparisonService,
      ],
    });
    handler = kit.module.get(GetRevisionChangesHandler);
  });

  afterAll(async () => {
    await kit.close();
  });
});
