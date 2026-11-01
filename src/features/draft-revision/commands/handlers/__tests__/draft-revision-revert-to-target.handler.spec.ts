import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl';
import { countSqlStatements } from 'src/__tests__/utils/sql-statements';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { RevertTarget } from './support/revert-target';

const PRODUCTS = 'products';
const GOODS = 'goods';
const CATEGORIES = 'categories';
const DOCUMENTS = 'documents';

const productSchema = obj({ code: str(), price: num() });
const categorySchema = obj({ title: str() });
const documentSchema = obj({ title: str(), image: ref(SystemSchemaIds.File) });

const emptyFile = {
  status: '',
  fileId: '',
  url: '',
  fileName: '',
  hash: '',
  extension: '',
  mimeType: '',
  size: 0,
  width: 0,
  height: 0,
};

describe('DraftRevisionRevertToTargetHandler', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('table outcomes', () => {
    it('keeps the Draft version of an unchanged table and returns the Draft id', async () => {
      const draft = await givenDraftWithEditedPrices();
      const draftVersionId = await draft.tableVersionId('draft', PRODUCTS);

      const revertedDraftId = await revertTo(draft, {
        tableId: PRODUCTS,
        outcome: 'unchanged',
      });

      expect(revertedDraftId).toBe(await draft.revisionId('draft'));
      expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(
        draftVersionId,
      );
    });

    it('unlinks the Draft version of an absent table', async () => {
      const draft = await givenCommittedProducts();
      await draft.createTable(CATEGORIES, categorySchema);

      await revertTo(draft, {
        tableId: CATEGORIES,
        outcome: 'absent',
        structureSide: 'head',
      });

      expect(await draft.hasTable('draft', CATEGORIES)).toBe(false);
    });

    it('links the structure-side version of a base table', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameTable(PRODUCTS, GOODS);

      await revertTo(draft, {
        tableId: GOODS,
        outcome: 'base',
        structureSide: 'head',
      });

      expect(await draft.hasTable('draft', GOODS)).toBe(false);
      await expectDraftLinksHeadVersion(draft, PRODUCTS);
    });

    it('links the other-side version of a table whose rows all take the other side', async () => {
      const draft = await givenDraftWithEditedPrices();

      await revertTo(draft, { tableId: PRODUCTS, outcome: 'other' });

      await expectDraftLinksHeadVersion(draft, PRODUCTS);
    });
  });

  describe('mixed tables', () => {
    it('edits a mutable Draft version in place: Head versions, new merged versions and kept Draft versions', async () => {
      const draft = await givenDraftWithEditedPrices();
      const draftVersionId = await draft.tableVersionId('draft', PRODUCTS);
      const head = await rowVersionsOf(draft, 'head', PRODUCTS);
      const before = await rowVersionsOf(draft, 'draft', PRODUCTS);

      await revertTo(draft, mixedProducts('draft'));

      expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(
        draftVersionId,
      );
      await expectMixedProductRows(draft, {
        fromHead: { p1: head.p1, p3: head.p3 },
        fromDraft: { p4: before.p4 },
        replaced: [head.p2, before.p2],
      });
    });

    it('edits a renamed mutable Draft version in place and keeps its public id', async () => {
      const draft = await givenDraftWithEditedPrices();
      await draft.renameTable(PRODUCTS, GOODS);
      const draftVersionId = await draft.tableVersionId('draft', GOODS);
      const head = await rowVersionsOf(draft, 'head', PRODUCTS);

      await revertTo(draft, {
        tableId: GOODS,
        outcome: 'mixed',
        rows: { otherSide: ['p1'] },
      });

      expect(await draft.tableVersionId('draft', GOODS)).toBe(draftVersionId);
      expect((await rowVersionsOf(draft, 'draft', GOODS)).p1).toBe(head.p1);
    });

    it('creates a new mutable version from the Draft links when the Draft version is readonly', async () => {
      const draft = await givenDraftWithEditedPrices();
      const previous = await givenReadonlyDraftVersion(draft, PRODUCTS);
      const head = await rowVersionsOf(draft, 'head', PRODUCTS);
      const before = await rowVersionsOf(draft, 'draft', PRODUCTS);

      await revertTo(draft, mixedProducts('draft'));

      await expectNewMutableVersionOf(draft, PRODUCTS, previous);
      await expectMixedProductRows(draft, {
        fromHead: { p1: head.p1, p3: head.p3 },
        fromDraft: { p4: before.p4 },
        replaced: [head.p2, before.p2],
      });
      expect(await rowVersionsOfVersion(previous)).toEqual(
        Object.values(before).sort(),
      );
    });

    it('creates a new mutable version from the Head links when the structure is reverted', async () => {
      const draft = await givenDraftWithEditedPrices();
      await draft.renameTable(PRODUCTS, GOODS);
      const head = await rowVersionsOf(draft, 'head', PRODUCTS);
      const kept = await rowVersionsOf(draft, 'draft', GOODS);
      const headVersionId = await draft.tableVersionId('head', PRODUCTS);

      await revertTo(draft, { ...mixedProducts('head'), tableId: GOODS });

      expect(await draft.hasTable('draft', GOODS)).toBe(false);
      await expectNewMutableVersionOf(draft, PRODUCTS, headVersionId);
      await expectMixedProductRows(draft, {
        fromHead: { p3: head.p3 },
        fromDraft: { p1: kept.p1, p4: kept.p4 },
        replaced: [head.p2, kept.p2],
      });
    });

    it('creates merged row versions as mutable versions that only the Draft links', async () => {
      const draft = await givenDraftWithEditedPrices();

      await revertTo(draft, mixedProducts('draft'));

      const merged = await draft.row('draft', PRODUCTS, 'p2');
      expect(merged).toMatchObject({
        data: { code: 'two', price: 22 },
        readonly: false,
      });
      expect(await revisionsLinkingRow(merged.versionId)).toEqual([
        await draft.revisionId('draft'),
      ]);
    });
  });

  describe('relink candidates', () => {
    it('links the Head version when the written version has the same content (draft follows Head)', async () => {
      const draft = await givenDraftWithEditedPrices();

      await revertTo(draft, {
        tableId: PRODUCTS,
        outcome: 'mixed',
        rows: { otherSide: ['p1', 'p2'], absent: ['p4'] },
        relinkCandidate: true,
      });

      await expectDraftLinksHeadVersion(draft, PRODUCTS);
    });

    it('keeps the written version when its content differs from Head', async () => {
      const draft = await givenCommittedProducts();
      await draft.writeRowColumns(PRODUCTS, 'p1', { meta: { note: 'draft' } });
      const draftVersionId = await draft.tableVersionId('draft', PRODUCTS);

      await revertTo(draft, {
        tableId: PRODUCTS,
        outcome: 'mixed',
        rows: { merged: { p1: { data: { code: 'one', price: 1 } } } },
        relinkCandidate: true,
      });

      expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(
        draftVersionId,
      );
      expect(await draft.row('draft', PRODUCTS, 'p1')).toMatchObject({
        meta: { note: 'draft' },
      });
    });
  });

  describe('file references', () => {
    it('registers the files of new row versions in a table with File fields', async () => {
      const draft = await givenDraftWithUploadedImage();
      const uploaded = await draft.row('draft', DOCUMENTS, 'd1');

      await revertTo(draft, {
        tableId: DOCUMENTS,
        outcome: 'mixed',
        rows: { merged: { d1: { data: titled(uploaded.data, 'reverted') } } },
        hasFileFields: true,
      });

      const merged = await draft.row('draft', DOCUMENTS, 'd1');
      expect(merged.versionId).not.toBe(uploaded.versionId);
      expect(await blobIdsOf(merged.versionId)).toEqual(
        await blobIdsOf(uploaded.versionId),
      );
      expect(await blobIdsOf(merged.versionId)).toHaveLength(1);
    });

    it('registers no files in a table without File fields', async () => {
      const draft = await givenDraftWithEditedPrices();
      const registrations = spyOnFileRegistrations();

      await revertTo(draft, mixedProducts('draft'));

      expect(registrations).not.toHaveBeenCalled();
    });

    it('registers no files for new row versions that the relink replaced with the Head version', async () => {
      const draft = await givenDraftWithUploadedImage();
      const headRow = await draft.row('head', DOCUMENTS, 'd1');
      const registrations = spyOnFileRegistrations();

      await revertTo(draft, {
        tableId: DOCUMENTS,
        outcome: 'mixed',
        rows: { merged: { d1: { data: headRow.data } } },
        relinkCandidate: true,
        hasFileFields: true,
      });

      await expectDraftLinksHeadVersion(draft, DOCUMENTS);
      expect(registrations).not.toHaveBeenCalled();
    });
  });

  describe('hasChanges', () => {
    it('is false when the target equals Head', async () => {
      const draft = await givenDraftWithEditedPrices();

      await revertTo(draft, { tableId: PRODUCTS, outcome: 'other' });

      expect(await hasChanges(draft)).toBe(false);
    });

    it('stays true while the Draft keeps changes', async () => {
      const draft = await givenDraftWithEditedPrices();

      await revertTo(draft, {
        tableId: PRODUCTS,
        outcome: 'mixed',
        rows: { otherSide: ['p1'] },
      });

      expect(await hasChanges(draft)).toBe(true);
    });
  });

  it('writes system tables like user tables', async () => {
    const draft = await givenCommittedProducts();
    await draft.createTable(CATEGORIES, categorySchema);
    const target = new RevertTarget(kit, draft);

    await target.revert(
      { tableId: CATEGORIES, outcome: 'absent', structureSide: 'head' },
      {
        tableId: SystemTables.Schema,
        outcome: 'mixed',
        rows: { absent: [CATEGORIES] },
        relinkCandidate: true,
      },
      {
        tableId: SystemTables.Migration,
        outcome: 'mixed',
        rows: { absent: await target.draftOnlyRowIds(SystemTables.Migration) },
        relinkCandidate: true,
      },
    );

    await expectDraftLinksHeadVersion(draft, SystemTables.Schema);
    await expectDraftLinksHeadVersion(draft, SystemTables.Migration);
    expect(await hasChanges(draft)).toBe(false);
  });

  it('writes in the caller transaction, so a failing caller leaves the Draft as it was', async () => {
    const draft = await givenDraftWithEditedPrices();
    const draftVersionId = await draft.tableVersionId('draft', PRODUCTS);
    const before = await rowVersionsOf(draft, 'draft', PRODUCTS);

    await expect(
      new RevertTarget(kit, draft).revertInFailingCaller(
        mixedProducts('draft'),
      ),
    ).rejects.toThrow('The caller failed after the write');

    expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(draftVersionId);
    expect(await rowVersionsOf(draft, 'draft', PRODUCTS)).toEqual(before);
  });

  describe('write cost', () => {
    it.each<RevisionSide>(['draft', 'head'])(
      'writes a mixed table with structure side %s in as many SQL statements for 1,000 rows as for 10',
      async (structureSide) => {
        const statements = await sqlStatementsToMergeEveryRow(
          10,
          structureSide,
        );

        await expect(
          sqlStatementsToMergeEveryRow(1_000, structureSide),
        ).resolves.toBe(statements);
      },
    );
  });

  function revertTo(
    draft: ChangesScenario,
    ...targets: Parameters<RevertTarget['revert']>
  ): Promise<string> {
    return new RevertTarget(kit, draft).revert(...targets);
  }

  function mixedProducts(structureSide: RevisionSide) {
    return {
      tableId: PRODUCTS,
      outcome: 'mixed' as const,
      structureSide,
      rows: {
        otherSide: otherSideRowsOf(structureSide),
        merged: { p2: { data: { code: 'two', price: 22 } } },
      },
    };
  }

  function otherSideRowsOf(structureSide: RevisionSide): string[] {
    if (structureSide === 'draft') {
      return ['p1'];
    }

    return ['p1', 'p4'];
  }

  async function expectMixedProductRows(
    draft: ChangesScenario,
    { fromHead, fromDraft, replaced }: MixedProductRows,
  ): Promise<void> {
    const rows = await rowVersionsOf(draft, 'draft', PRODUCTS);

    expect(rows).toEqual({
      ...fromHead,
      ...fromDraft,
      p2: expect.any(String),
    });
    expect(replaced).not.toContain(rows.p2);
    expect(await draft.row('draft', PRODUCTS, 'p2')).toMatchObject({
      data: { code: 'two', price: 22 },
      readonly: false,
    });
  }

  async function expectDraftLinksHeadVersion(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<void> {
    expect(await draft.tableVersionId('draft', tableId)).toBe(
      await draft.tableVersionId('head', tableId),
    );
  }

  async function expectNewMutableVersionOf(
    draft: ChangesScenario,
    tableId: string,
    sourceVersionId: string,
  ): Promise<void> {
    const versionId = await draft.tableVersionId('draft', tableId);
    const source = await tableVersion(sourceVersionId);

    expect(versionId).not.toBe(sourceVersionId);
    expect(await tableVersion(versionId)).toMatchObject({
      createdId: source.createdId,
      id: source.id,
      system: source.system,
      createdAt: source.createdAt,
      readonly: false,
    });
  }

  async function sqlStatementsToMergeEveryRow(
    rowCount: number,
    structureSide: RevisionSide,
  ): Promise<number> {
    const rowIds = Array.from({ length: rowCount }, (_, index) => `r${index}`);
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: Object.fromEntries(
          rowIds.map((rowId) => [rowId, { code: rowId, price: 1 }]),
        ),
      },
    });
    await draft.updateRow(PRODUCTS, 'r0', { code: 'r0', price: 2 });
    const target = new RevertTarget(kit, draft);
    const plan = await target.plan({
      tableId: PRODUCTS,
      outcome: 'mixed',
      structureSide,
      rows: {
        otherSide: ['r0'],
        merged: Object.fromEntries(
          rowIds
            .slice(1)
            .map((rowId) => [rowId, { data: { code: rowId, price: 3 } }]),
        ),
      },
    });

    return countSqlStatements(() => target.write(plan));
  }

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { code: 'one', price: 1 },
          p2: { code: 'two', price: 2 },
          p3: { code: 'three', price: 3 },
        },
      },
    });
  }

  async function givenDraftWithEditedPrices(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.updateRow(PRODUCTS, 'p1', { code: 'one', price: 11 });
    await draft.updateRow(PRODUCTS, 'p2', { code: 'changed', price: 22 });
    await draft.createRows(PRODUCTS, { p4: { code: 'four', price: 4 } });

    return draft;
  }

  async function givenDraftWithUploadedImage(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [DOCUMENTS]: {
        schema: documentSchema,
        rows: { d1: { title: 'one', image: emptyFile } },
      },
    });
    await draft.uploadFile(DOCUMENTS, 'd1', 'image');

    return draft;
  }

  async function givenReadonlyDraftVersion(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<string> {
    const versionId = await draft.tableVersionId('draft', tableId);

    await kit.prisma.table.update({
      where: { versionId },
      data: { readonly: true },
    });

    return versionId;
  }

  function spyOnFileRegistrations() {
    return jest.spyOn(
      kit.module.get(FileUsageIntegrationService),
      'registerReferencesForRowVersions',
    );
  }

  async function rowVersionsOf(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
  ): Promise<Record<string, string>> {
    const rows = await kit.prisma.row.findMany({
      where: {
        tables: {
          some: { versionId: await draft.tableVersionId(side, tableId) },
        },
      },
      select: { id: true, versionId: true },
    });

    return Object.fromEntries(rows.map((row) => [row.id, row.versionId]));
  }

  async function rowVersionsOfVersion(
    tableVersionId: string,
  ): Promise<string[]> {
    const rows = await kit.prisma.row.findMany({
      where: { tables: { some: { versionId: tableVersionId } } },
      select: { versionId: true },
    });

    return rows.map((row) => row.versionId).sort();
  }

  function tableVersion(versionId: string) {
    return kit.prisma.table.findUniqueOrThrow({ where: { versionId } });
  }

  async function revisionsLinkingRow(rowVersionId: string): Promise<string[]> {
    const revisions = await kit.prisma.revision.findMany({
      where: {
        tables: { some: { rows: { some: { versionId: rowVersionId } } } },
      },
      select: { id: true },
    });

    return revisions.map((revision) => revision.id);
  }

  async function blobIdsOf(rowVersionId: string): Promise<string[]> {
    const row = await kit.prisma.row.findUniqueOrThrow({
      where: { versionId: rowVersionId },
      select: { fileBlobs: { select: { id: true } } },
    });

    return row.fileBlobs.map((blob) => blob.id).sort();
  }

  async function hasChanges(draft: ChangesScenario): Promise<boolean> {
    const revision = await kit.prisma.revision.findUniqueOrThrow({
      where: { id: await draft.revisionId('draft') },
      select: { hasChanges: true },
    });

    return revision.hasChanges;
  }
});

function titled(data: JsonValue, title: string): JsonValue {
  return { ...(data as Record<string, JsonValue>), title };
}

interface MixedProductRows {
  readonly fromHead: Record<string, string | undefined>;
  readonly fromDraft: Record<string, string | undefined>;
  readonly replaced: readonly (string | undefined)[];
}
