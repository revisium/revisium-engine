import { SystemTables } from 'src/features/share/system-tables.consts';
import { RevisionComparisonService } from '../revision-comparison.service';
import { createRevisionChangesTestKit } from 'src/features/revision-changes/__tests__/revision-changes-test-kit';
import type { Prisma } from 'src/__generated__/client';
import {
  createRevision,
  createRevisionPair,
  createTableVersion,
  createRowVersion,
  createBranch,
} from 'src/features/revision-changes/__tests__/revision-changes.fixtures';

describe('RevisionComparisonService', () => {
  describe('getMigrationsForTable', () => {
    it('should return migrations from the migration table for a specific table', async () => {
      const { revision, table, migrationData } = await prepareMigrationData();

      const result = await service.getMigrationsForTable(
        revision.id,
        table.createdId,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: migrationData.id,
        tableId: table.id,
        changeType: migrationData.changeType,
      });
    });

    it('should return empty array when no migrations exist for table', async () => {
      const { revision } = await prepareRevisionWithMigrationTable();

      const result = await service.getMigrationsForTable(
        revision.id,
        'non-existent-created-id',
      );

      expect(result).toEqual([]);
    });

    it('should return multiple migrations for the same table ordered by publishedAt desc', async () => {
      const { revision, table, migrations } = await prepareMultipleMigrations();
      const [firstMigration, secondMigration] = migrations;

      const result = await service.getMigrationsForTable(
        revision.id,
        table.createdId,
      );

      expect(result).toHaveLength(2);
      expect((result[0] as Record<string, unknown>).id).toBe(
        secondMigration.id,
      );
      expect((result[1] as Record<string, unknown>).id).toBe(firstMigration.id);
    });
  });

  describe('getMigrationsForTableBetweenRevisions', () => {
    it('should return only new migrations between revisions', async () => {
      const { fromRevision, toRevision, table, newMigration } =
        await prepareMigrationsBetweenRevisions();

      const result = await service.getMigrationsForTableBetweenRevisions(
        fromRevision.id,
        toRevision.id,
        table.createdId,
      );

      expect(result).toHaveLength(1);
      expect((result[0] as Record<string, unknown>).id).toBe(newMigration.id);
    });

    it('should return empty array when no new migrations exist', async () => {
      const { fromRevision, toRevision, table } = await prepareSameMigrations();

      const result = await service.getMigrationsForTableBetweenRevisions(
        fromRevision.id,
        toRevision.id,
        table.createdId,
      );

      expect(result).toEqual([]);
    });
  });

  async function prepareMigrationData() {
    const branch = await createBranch(kit.prismaService);
    const revision = await createRevision(kit.prismaService, branch.id);
    const migrationTable = await createMigrationTable(revision.id);
    const table = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: revision.id,
      id: 'test-table',
    });

    const migrationData = {
      id: 'migration-' + table.id,
      tableId: table.id,
      changeType: 'init',
    };

    await createMigrationRow({
      tableVersionId: migrationTable.versionId,
      data: migrationData,
    });

    return { revision, table, migrationData };
  }

  async function prepareRevisionWithMigrationTable() {
    const branch = await createBranch(kit.prismaService);
    const revision = await createRevision(kit.prismaService, branch.id);
    await createMigrationTable(revision.id);

    return { revision };
  }

  async function prepareMultipleMigrations() {
    const branch = await createBranch(kit.prismaService);
    const revision = await createRevision(kit.prismaService, branch.id);
    const migrationTable = await createMigrationTable(revision.id);
    const table = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: revision.id,
      id: 'test-table',
    });
    const now = new Date();

    const migrations = [
      { id: 'migration-1', tableId: table.id, changeType: 'init' },
      { id: 'migration-2', tableId: table.id, changeType: 'update' },
    ] as const;
    const [firstMigration, secondMigration] = migrations;

    await createMigrationRow({
      tableVersionId: migrationTable.versionId,
      data: firstMigration,
      publishedAt: new Date(now.getTime() - 1000),
    });
    await createMigrationRow({
      tableVersionId: migrationTable.versionId,
      data: secondMigration,
      publishedAt: now,
    });

    return { revision, table, migrations };
  }

  async function prepareMigrationsBetweenRevisions() {
    const { fromRevision, toRevision } = await createRevisionPair(
      kit.prismaService,
    );
    const fromMigrationTable = await createMigrationTable(fromRevision.id);
    const toMigrationTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      id: SystemTables.Migration,
      createdId: fromMigrationTable.createdId,
      system: true,
      readonly: true,
    });
    const fromTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
      id: 'test-table',
    });
    const table = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      id: fromTable.id,
      createdId: fromTable.createdId,
    });

    const oldMigration = {
      id: 'migration-old',
      tableId: table.id,
      changeType: 'init',
    };
    const newMigration = {
      id: 'migration-new',
      tableId: table.id,
      changeType: 'update',
    };

    await createMigrationRow({
      tableVersionId: fromMigrationTable.versionId,
      data: oldMigration,
      publishedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await createMigrationRow({
      tableVersionId: toMigrationTable.versionId,
      data: oldMigration,
      publishedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await createMigrationRow({
      tableVersionId: toMigrationTable.versionId,
      data: newMigration,
      publishedAt: new Date('2025-01-02T00:00:00.000Z'),
    });

    return { fromRevision, toRevision, table, newMigration };
  }

  async function prepareSameMigrations() {
    const { fromRevision, toRevision } = await createRevisionPair(
      kit.prismaService,
    );
    const fromMigrationTable = await createMigrationTable(fromRevision.id);
    const toMigrationTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      id: SystemTables.Migration,
      createdId: fromMigrationTable.createdId,
      system: true,
      readonly: true,
    });
    const fromTable = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: fromRevision.id,
      id: 'test-table',
    });
    const table = await createTableVersion({
      prismaService: kit.prismaService,
      revisionId: toRevision.id,
      id: fromTable.id,
      createdId: fromTable.createdId,
    });

    const migration = {
      id: 'migration-shared',
      tableId: table.id,
      changeType: 'init',
    };

    await createMigrationRow({
      tableVersionId: fromMigrationTable.versionId,
      data: migration,
      publishedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await createMigrationRow({
      tableVersionId: toMigrationTable.versionId,
      data: migration,
      publishedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    return { fromRevision, toRevision, table };
  }

  async function createMigrationTable(revisionId: string) {
    return createTableVersion({
      prismaService: kit.prismaService,
      revisionId,
      id: SystemTables.Migration,
      system: true,
      readonly: true,
    });
  }

  async function createMigrationRow({
    tableVersionId,
    data,
    publishedAt = new Date(),
  }: {
    tableVersionId: string;
    data: Prisma.InputJsonValue & Record<string, unknown>;
    publishedAt?: Date;
  }) {
    return createRowVersion({
      prismaService: kit.prismaService,
      tableVersionId,
      id: String(data.id),
      data,
      publishedAt,
    });
  }

  let kit: Awaited<ReturnType<typeof createRevisionChangesTestKit>>;
  let service: RevisionComparisonService;

  beforeAll(async () => {
    kit = await createRevisionChangesTestKit({
      imports: [],
      providers: [RevisionComparisonService],
    });
    service = kit.module.get(RevisionComparisonService);
  });

  afterAll(async () => {
    await kit.close();
  });
});
