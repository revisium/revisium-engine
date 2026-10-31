import { nanoid } from 'nanoid';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import {
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { createMigrationRecord } from './migration-database';

const TABLE_ID = 'products';
const LEGACY_PATCHES = [
  { op: 'add', path: '/properties/price', value: { type: 'number' } },
];

export interface LegacyRecordShape {
  status: MigrationStatus;
  revision?: 'draft' | 'committed' | 'missing';
  linkedTable?: 'source' | 'shadow' | 'neither';
}

export async function givenLegacyRecord(
  prisma: PrismaService,
  { status, revision = 'draft', linkedTable = 'source' }: LegacyRecordShape,
): Promise<string> {
  const branch = await prepareBranch(prisma);
  const tables = {
    source: await createTableVersion(prisma),
    shadow: await createTableVersion(prisma),
  };
  const revisionId = {
    draft: branch.draftRevisionId,
    committed: branch.headRevisionId,
    missing: `missing-${nanoid()}`,
  }[revision];

  if (linkedTable !== 'neither') {
    await linkTable(prisma, revisionId, tables[linkedTable]);
  }

  const record = await createMigrationRecord(prisma, revisionId, status, {
    tableId: TABLE_ID,
    phase: status === MigrationStatus.PENDING ? MigrationPhase.INIT : status,
    payload: LEGACY_PATCHES,
    sourceTableVersionId: tables.source,
    shadowTableVersionId: tables.shadow,
  });

  return record.id;
}

async function createTableVersion(prisma: PrismaService): Promise<string> {
  const table = await prisma.table.create({
    data: { versionId: nanoid(), createdId: nanoid(), id: TABLE_ID },
  });

  return table.versionId;
}

async function linkTable(
  prisma: PrismaService,
  revisionId: string,
  tableVersionId: string,
): Promise<void> {
  await prisma.table.update({
    where: { versionId: tableVersionId },
    data: { revisions: { connect: { id: revisionId } } },
  });
}
