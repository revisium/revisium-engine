import { nanoid } from 'nanoid';
import {
  createDatabaseServiceTestKit,
  type DatabaseServiceTestKit,
} from 'src/__tests__/kit/create-database-service-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  COMPARED_ROW_COLUMNS,
  type ComparedRowColumn,
} from 'src/features/share/compared-columns';
import { DiffService } from 'src/features/share/diff.service';

interface RowContent {
  readonly createdId: string;
  readonly id: string;
  readonly data: InputJsonValue;
  readonly hash: string;
  readonly schemaHash: string;
  readonly publishedAt: Date;
  readonly meta: InputJsonValue;
}

const CHANGED_COLUMN: Record<ComparedRowColumn, Partial<RowContent>> = {
  id: { id: 'renamed' },
  hash: { data: { title: 'changed' }, hash: 'changed-hash' },
  schemaHash: { schemaHash: 'changed-schema-hash' },
  publishedAt: { publishedAt: new Date('2026-02-01T00:00:00.000Z') },
  meta: { meta: { note: 'changed' } },
};

describe('DiffService: table-version content check', () => {
  let kit: DatabaseServiceTestKit;
  let diffService: DiffService;

  beforeAll(async () => {
    kit = await createDatabaseServiceTestKit([DiffService]);
    diffService = kit.module.get(DiffService);
  });

  afterAll(async () => {
    await kit.close();
  });

  it('finds no difference between versions that link the same row versions', async () => {
    const row = rowContent();
    const shared = await givenRowVersion(row);
    const from = await givenTableVersion('products', [shared]);
    const to = await givenTableVersion('products', [shared]);

    await expect(contentDiffers(from, to)).resolves.toBe(false);
  });

  it('finds no difference between row versions that differ only in columns that are not content', async () => {
    const row = rowContent();
    const from = await givenTableVersion('products', [
      await givenRowVersion(row, { readonly: true }),
    ]);
    const to = await givenTableVersion('products', [
      await givenRowVersion(row, {
        readonly: false,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-02T00:00:00.000Z'),
      }),
    ]);

    await expect(contentDiffers(from, to)).resolves.toBe(false);
  });

  it.each(COMPARED_ROW_COLUMNS.map((column) => ({ column })))(
    'finds a difference when a row pair differs in $column',
    async ({ column }) => {
      const row = rowContent();
      const from = await givenTableVersion('products', [
        await givenRowVersion(row),
      ]);
      const to = await givenTableVersion('products', [
        await givenRowVersion({ ...row, ...CHANGED_COLUMN[column] }),
      ]);

      await expect(contentDiffers(from, to)).resolves.toBe(true);
    },
  );

  it('finds a difference when a row identity is on one side only', async () => {
    const shared = await givenRowVersion(rowContent());
    const from = await givenTableVersion('products', [shared]);
    const to = await givenTableVersion('products', [
      shared,
      await givenRowVersion(rowContent()),
    ]);

    await expect(contentDiffers(from, to)).resolves.toBe(true);
    await expect(contentDiffers(to, from)).resolves.toBe(true);
  });

  it('finds a difference when the table versions have different public ids', async () => {
    const shared = await givenRowVersion(rowContent());
    const from = await givenTableVersion('products', [shared]);
    const to = await givenTableVersion('goods', [shared]);

    await expect(contentDiffers(from, to)).resolves.toBe(true);
  });

  function contentDiffers(
    fromTableVersionId: string,
    toTableVersionId: string,
  ): Promise<boolean> {
    return diffService.hasTableVersionContentDiffs({
      fromTableVersionId,
      toTableVersionId,
    });
  }

  function rowContent(): RowContent {
    return {
      createdId: nanoid(),
      id: 'p1',
      data: { title: 'one' },
      hash: 'hash-one',
      schemaHash: 'schema-hash',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      meta: {},
    };
  }

  async function givenRowVersion(
    content: RowContent,
    columns: { readonly?: boolean; createdAt?: Date; updatedAt?: Date } = {},
  ): Promise<string> {
    const { versionId } = await kit.prismaService.row.create({
      data: { versionId: nanoid(), ...content, ...columns },
      select: { versionId: true },
    });

    return versionId;
  }

  async function givenTableVersion(
    id: string,
    rowVersionIds: readonly string[],
  ): Promise<string> {
    const { versionId } = await kit.prismaService.table.create({
      data: {
        versionId: nanoid(),
        createdId: 'table-identity',
        id,
        rows: { connect: rowVersionIds.map((rowId) => ({ versionId: rowId })) },
      },
      select: { versionId: true },
    });

    return versionId;
  }
});
