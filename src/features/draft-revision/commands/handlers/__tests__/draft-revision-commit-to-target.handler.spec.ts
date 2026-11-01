import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { countSqlStatements } from 'src/__tests__/utils/sql-statements';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import {
  addField,
  removeField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  type CommitResult,
  type CommitTableTarget,
  CommitTarget,
} from './support/commit-target';

const PRODUCTS = 'products';
const GOODS = 'goods';
const CATEGORIES = 'categories';
const TAGS = 'tags';
const DOCUMENTS = 'documents';

const productSchema = obj({ code: str(), price: num() });
const categorySchema = obj({ title: str() });
const documentSchema = obj({ title: str(), image: ref(SystemSchemaIds.File) });

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

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

describe('DraftRevisionCommitToTargetHandler', () => {
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

  describe('Head table versions', () => {
    it('keeps the Head version of an unchanged table', async () => {
      const draft = await givenDraftWithEditedPrices();
      const headVersionId = await draft.tableVersionId('head', PRODUCTS);

      await commitTo(draft, { tableId: PRODUCTS, outcome: 'unchanged' });

      expect(await draft.tableVersionId('head', PRODUCTS)).toBe(headVersionId);
    });

    it('links no version of a table whose removal is committed', async () => {
      const draft = await givenCommittedProductsAndCategories();
      await draft.removeTable(CATEGORIES);

      await commitTo(draft, {
        tableId: CATEGORIES,
        outcome: 'absent',
        structureSide: 'draft',
      });

      expect(await draft.hasTable('head', CATEGORIES)).toBe(false);
      expect(await draft.hasTable('draft', CATEGORIES)).toBe(false);
    });

    it('keeps an uncommitted created table out of Head and mutable in the next Draft', async () => {
      const draft = await givenDraftWithCreatedCategories();
      const draftVersionId = await draft.tableVersionId('draft', CATEGORIES);

      await commitTo(draft, { tableId: CATEGORIES, outcome: 'absent' });

      expect(await draft.hasTable('head', CATEGORIES)).toBe(false);
      expect(await draft.tableVersionId('draft', CATEGORIES)).toBe(
        draftVersionId,
      );
      await expectMutableWithRows(draftVersionId);
    });

    it('links the Draft version of a committed created table and marks it readonly with its rows', async () => {
      const draft = await givenDraftWithCreatedCategories();
      const draftVersionId = await draft.tableVersionId('draft', CATEGORIES);

      await commitTo(draft, {
        tableId: CATEGORIES,
        outcome: 'base',
        structureSide: 'draft',
      });

      expect(await draft.tableVersionId('head', CATEGORIES)).toBe(
        draftVersionId,
      );
      await expectReadonlyWithRows(draftVersionId);
    });

    it('links the Draft version of a table whose rows all take the Draft side and marks it readonly with its rows', async () => {
      const draft = await givenDraftWithEditedPrices();
      const draftVersionId = await draft.tableVersionId('draft', PRODUCTS);

      await commitTo(draft, { tableId: PRODUCTS, outcome: 'other' });

      expect(await draft.tableVersionId('head', PRODUCTS)).toBe(draftVersionId);
      await expectReadonlyWithRows(draftVersionId);
    });

    it('keeps the versions of tables the plan does not name: Head its own, the next Draft the Draft ones', async () => {
      const draft = await givenCommittedProductsAndCategories();
      await draft.updateRow(PRODUCTS, 'p1', { code: 'one', price: 11 });
      await draft.updateRow(CATEGORIES, 'c1', { title: 'changed' });
      const headVersionId = await draft.tableVersionId('head', CATEGORIES);
      const draftVersionId = await draft.tableVersionId('draft', CATEGORIES);

      await commitTo(draft, { tableId: PRODUCTS, outcome: 'other' });

      expect(await draft.tableVersionId('head', CATEGORIES)).toBe(
        headVersionId,
      );
      expect(await draft.tableVersionId('draft', CATEGORIES)).toBe(
        draftVersionId,
      );
    });
  });

  describe('mixed tables', () => {
    it('writes a new readonly Head version: Head links, the taken Draft versions and readonly merged versions', async () => {
      const draft = await givenDraftWithEditedPrices();
      const headVersionId = await draft.tableVersionId('head', PRODUCTS);
      const head = await rowVersionsOf(draft, 'head', PRODUCTS);
      const drafted = await rowVersionsOf(draft, 'draft', PRODUCTS);

      await commitTo(draft, mixedProducts());

      await expectNewReadonlyHeadVersionOf(draft, PRODUCTS, headVersionId);
      const committed = await rowVersionsOf(draft, 'head', PRODUCTS);
      expect(committed).toEqual({
        p1: drafted.p1,
        p2: expect.any(String),
        p3: head.p3,
        p4: drafted.p4,
      });
      expect([head.p2, drafted.p2]).not.toContain(committed.p2);
      expect(await draft.row('head', PRODUCTS, 'p2')).toMatchObject({
        data: { code: 'two', price: 22 },
        readonly: true,
      });
    });

    it('writes a new readonly Head version from the Draft links when the structure is committed', async () => {
      const draft = await givenDraftWithEditedPrices();
      await draft.renameTable(PRODUCTS, GOODS);
      const head = await rowVersionsOf(draft, 'head', PRODUCTS);
      const drafted = await rowVersionsOf(draft, 'draft', GOODS);
      const draftVersionId = await draft.tableVersionId('draft', GOODS);

      await commitTo(draft, {
        tableId: GOODS,
        outcome: 'mixed',
        structureSide: 'draft',
        rows: { otherSide: ['p2'], absent: ['p4'] },
      });

      expect(await draft.hasTable('head', PRODUCTS)).toBe(false);
      await expectNewReadonlyHeadVersionOf(draft, GOODS, draftVersionId);
      expect(await rowVersionsOf(draft, 'head', GOODS)).toEqual({
        p1: drafted.p1,
        p2: head.p2,
        p3: head.p3,
      });
      expect(await draft.tableVersionId('draft', GOODS)).toBe(draftVersionId);
    });
  });

  describe('next Draft table versions', () => {
    it('links the new Head version when a relink candidate has the same content (draft follows Head)', async () => {
      const draft = await givenDraftWithEditedPrice();

      await commitTo(draft, {
        tableId: PRODUCTS,
        outcome: 'mixed',
        rows: { otherSide: ['p1'] },
        relinkCandidate: true,
      });

      expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(
        await draft.tableVersionId('head', PRODUCTS),
      );
    });

    it('keeps the Draft version when a relink candidate differs from the new Head version', async () => {
      const draft = await givenDraftWithEditedPrices();
      const draftVersionId = await draft.tableVersionId('draft', PRODUCTS);

      await commitTo(draft, {
        tableId: PRODUCTS,
        outcome: 'mixed',
        rows: { otherSide: ['p1'] },
        relinkCandidate: true,
      });

      expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(
        draftVersionId,
      );
      expect(await draft.row('draft', PRODUCTS, 'p2')).toMatchObject({
        data: { code: 'changed', price: 22 },
      });
    });

    it('keeps the Draft version of a table that is not a relink candidate', async () => {
      const draft = await givenDraftWithEditedPrice();
      const draftVersionId = await draft.tableVersionId('draft', PRODUCTS);

      await commitTo(draft, {
        tableId: PRODUCTS,
        outcome: 'mixed',
        rows: { otherSide: ['p1'] },
      });

      expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(
        draftVersionId,
      );
    });

    it('writes a new mutable ledger version with the renumbered pending migrations', async () => {
      const draft = await givenDraftWithPendingMigrations();
      const [first, second] = await pendingMigrationIdsOf(draft);
      const draftLedgerVersionId = await draft.tableVersionId(
        'draft',
        SystemTables.Migration,
      );
      const draftLedger = await rowsOf(draftLedgerVersionId);
      const published = await rowVersionsOf(
        draft,
        'head',
        SystemTables.Migration,
      );

      await commitTo(draft, {
        tableId: SystemTables.Migration,
        outcome: 'unchanged',
        renumbered: { [first]: laterId(first), [second]: laterId(second) },
      });

      const ledgerVersionId = await draft.tableVersionId(
        'draft',
        SystemTables.Migration,
      );
      await expectCopiedVersion(ledgerVersionId, draftLedgerVersionId, {
        readonly: false,
      });
      const ledger = await rowsOf(ledgerVersionId);
      expect(Object.keys(ledger).sort()).toEqual(
        [...Object.keys(published), laterId(first), laterId(second)].sort(),
      );
      expect(versionIdsOf(ledger, Object.keys(published))).toEqual(published);
      expectRenumbered(ledger, draftLedger, first);
      expectRenumbered(ledger, draftLedger, second);
    });
  });

  describe('revisions', () => {
    it('turns the Draft into Head with the comment and opens the next Draft after it', async () => {
      const draft = await givenDraftWithEditedPrices();
      const previousHeadId = await draft.revisionId('head');
      const formerDraftId = await draft.revisionId('draft');
      const target = new CommitTarget(kit, draft);
      const plan = await target.plan({ tableId: PRODUCTS, outcome: 'other' });

      const result = await target.write({ ...plan, comment: 'prices' });

      const nextDraftId = await draft.revisionId('draft');
      expect(result).toEqual({
        previousHeadRevisionId: previousHeadId,
        headRevisionId: formerDraftId,
        draftRevisionId: nextDraftId,
      });
      expect(await revision(previousHeadId)).toMatchObject({
        isHead: false,
        isDraft: false,
        hasChanges: false,
      });
      const head = await revision(formerDraftId);
      expect(head).toMatchObject({
        isHead: true,
        isDraft: false,
        hasChanges: false,
        comment: 'prices',
      });
      const nextDraft = await revision(nextDraftId);
      expect(nextDraft).toMatchObject({
        isHead: false,
        isDraft: true,
        parentId: formerDraftId,
        branchId: draft.branchId,
      });
      expect(nextDraft.sequence).toBeGreaterThan(head.sequence);
    });

    it('writes in the caller transaction, so a failing caller leaves the branch as it was', async () => {
      const draft = await givenDraftWithEditedPrices();
      const headId = await draft.revisionId('head');
      const draftId = await draft.revisionId('draft');
      const draftVersionId = await draft.tableVersionId('draft', PRODUCTS);

      await expect(
        new CommitTarget(kit, draft).commitInFailingCaller(mixedProducts()),
      ).rejects.toThrow('The caller failed after the write');

      expect(await draft.revisionId('head')).toBe(headId);
      expect(await draft.revisionId('draft')).toBe(draftId);
      expect(await draft.tableVersionId('draft', PRODUCTS)).toBe(
        draftVersionId,
      );
      expect(await tableVersion(draftVersionId)).toMatchObject({
        readonly: false,
      });
      expect(await draft.row('draft', PRODUCTS, 'p1')).toMatchObject({
        readonly: false,
      });
    });
  });

  describe('readonly locking', () => {
    it('leaves no mutable table or row version in the new Head', async () => {
      const draft = await givenDraftWithEditedPrices();
      await draft.createTable(CATEGORIES, categorySchema);
      await draft.createRows(CATEGORIES, { c1: { title: 'one' } });

      const { headRevisionId } = await commitTo(draft, mixedProducts(), {
        tableId: CATEGORIES,
        outcome: 'base',
        structureSide: 'draft',
      });

      expect(await mutableVersionsLinkedBy(headRevisionId)).toEqual([]);
    });

    it('rewrites only the Draft row versions newly linked into Head', async () => {
      const draft = await givenDraftWithEditedPrices();
      await draft.createTable(CATEGORIES, categorySchema);
      await draft.createRows(CATEGORIES, { c1: { title: 'one' } });
      const drafted = await rowVersionsOf(draft, 'draft', PRODUCTS);
      const categoriesVersionId = await draft.tableVersionId(
        'draft',
        CATEGORIES,
      );
      const writes = await rowWritesOf(draft);

      await commitTo(
        draft,
        { tableId: PRODUCTS, outcome: 'other' },
        { tableId: CATEGORIES, outcome: 'absent' },
      );

      expect(rewrittenSince(writes, await rowWritesOf(draft))).toEqual(
        [drafted.p1, drafted.p2, drafted.p4].sort(),
      );
      await expectMutableWithRows(categoriesVersionId);
    });

    it('never changes a version the previous Head links', async () => {
      const draft = await givenDraftWithEditedPrices();
      const previousHeadId = await draft.revisionId('head');
      const headVersionId = await draft.tableVersionId('head', PRODUCTS);
      const head = await rowVersionsOf(draft, 'head', PRODUCTS);
      const writes = await rowWritesOf(draft);

      await commitTo(draft, mixedProducts());

      expect(await tableVersionsLinkedBy(previousHeadId)).toContain(
        headVersionId,
      );
      expect(await rowVersionIdsOf(headVersionId)).toEqual(
        Object.values(head).sort(),
      );
      const rewritten = rewrittenSince(writes, await rowWritesOf(draft));
      expect(
        Object.values(head).filter((versionId) =>
          rewritten.includes(versionId),
        ),
      ).toEqual([]);
    });
  });

  describe('file references', () => {
    it('registers the files of new Head row versions against the new Head schema', async () => {
      const draft = await givenHeadImageWithDraftDroppingTheImageField();
      const headRow = await draft.row('head', DOCUMENTS, 'd1');

      await commitTo(draft, {
        tableId: DOCUMENTS,
        outcome: 'mixed',
        rows: { merged: { d1: { data: titled(headRow.data, 'committed') } } },
        hasFileFields: true,
      });

      const merged = await draft.row('head', DOCUMENTS, 'd1');
      expect(merged.versionId).not.toBe(headRow.versionId);
      expect(await blobIdsOf(merged.versionId)).toEqual(
        await blobIdsOf(headRow.versionId),
      );
      expect(await blobIdsOf(merged.versionId)).toHaveLength(1);
    });

    it('registers no files in a table without File fields', async () => {
      const draft = await givenDraftWithEditedPrices();
      const registrations = jest.spyOn(
        kit.module.get(FileUsageIntegrationService),
        'registerReferencesForRowVersions',
      );

      await commitTo(draft, mixedProducts());

      expect(registrations).not.toHaveBeenCalled();
    });
  });

  describe('hasChanges of the next Draft', () => {
    it('is false when the next Draft links the new Head versions', async () => {
      const draft = await givenDraftWithEditedPrices();

      await commitTo(draft, {
        tableId: PRODUCTS,
        outcome: 'other',
        relinkCandidate: true,
      });

      expect(await hasChanges(draft)).toBe(false);
    });

    it('stays true while the next Draft keeps changes', async () => {
      const draft = await givenDraftWithEditedPrices();

      await commitTo(draft, {
        tableId: PRODUCTS,
        outcome: 'mixed',
        rows: { otherSide: ['p1'] },
      });

      expect(await hasChanges(draft)).toBe(true);
    });
  });

  it('commits a whole Draft with the same content as native createRevision', async () => {
    const native = await givenDraftWithEveryKindOfChange();
    const written = await givenDraftWithEveryKindOfChange();

    await native.commit();
    const target = new CommitTarget(kit, written);
    await target.write(await target.wholeDraftPlan());

    expect(await branchContentOf(written)).toEqual(
      await branchContentOf(native),
    );
  });

  describe('write cost', () => {
    it.each<RevisionSide>(['head', 'draft'])(
      'commits a mixed table with structure side %s in as many SQL statements for 1,000 rows as for 10',
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

    it('links a whole Draft table version into Head in as many SQL statements for 1,000 rows as for 10', async () => {
      const statements = await sqlStatementsToCommitCreatedTable(10);

      await expect(sqlStatementsToCommitCreatedTable(1_000)).resolves.toBe(
        statements,
      );
    });
  });

  function commitTo(
    draft: ChangesScenario,
    ...targets: CommitTableTarget[]
  ): Promise<CommitResult> {
    return new CommitTarget(kit, draft).commit(...targets);
  }

  function mixedProducts(): CommitTableTarget {
    return {
      tableId: PRODUCTS,
      outcome: 'mixed',
      rows: {
        otherSide: ['p1', 'p4'],
        merged: { p2: { data: { code: 'two', price: 22 } } },
      },
    };
  }

  async function expectNewReadonlyHeadVersionOf(
    draft: ChangesScenario,
    tableId: string,
    sourceVersionId: string,
  ): Promise<void> {
    const versionId = await draft.tableVersionId('head', tableId);

    await expectCopiedVersion(versionId, sourceVersionId, { readonly: true });
    await expectReadonlyWithRows(versionId);
  }

  async function expectCopiedVersion(
    versionId: string,
    sourceVersionId: string,
    { readonly }: { readonly: boolean },
  ): Promise<void> {
    const source = await tableVersion(sourceVersionId);

    expect(versionId).not.toBe(sourceVersionId);
    expect(await tableVersion(versionId)).toMatchObject({
      createdId: source.createdId,
      id: source.id,
      system: source.system,
      createdAt: source.createdAt,
      readonly,
    });
  }

  async function expectReadonlyWithRows(tableVersionId: string): Promise<void> {
    expect(await readonlyFlagsOf(tableVersionId)).toEqual({
      table: true,
      rows: [true],
    });
  }

  async function expectMutableWithRows(tableVersionId: string): Promise<void> {
    expect(await readonlyFlagsOf(tableVersionId)).toEqual({
      table: false,
      rows: [false],
    });
  }

  function expectRenumbered(
    ledger: Readonly<Record<string, Row>>,
    draftLedger: Readonly<Record<string, Row>>,
    migrationId: string,
  ): void {
    const source = requiredRow(draftLedger, migrationId);
    const id = laterId(migrationId);
    const renumbered = requiredRow(ledger, id);

    expect(renumbered).toEqual({
      ...source,
      versionId: expect.any(String),
      id,
      data: { ...(source.data as Record<string, JsonValue>), id },
      hash: expect.any(String),
      publishedAt: new Date(id),
      updatedAt: expect.any(Date),
      readonly: false,
    });
    expect(renumbered.versionId).not.toBe(source.versionId);
  }

  async function pendingMigrationIdsOf(
    draft: ChangesScenario,
  ): Promise<[string, string]> {
    const [first, second, ...others] = (
      await new CommitTarget(kit, draft).draftOnlyRowIds(SystemTables.Migration)
    ).sort();

    if (first === undefined || second === undefined || others.length > 0) {
      throw new Error('The Draft must hold exactly two pending migrations');
    }

    return [first, second];
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
    const target = new CommitTarget(kit, draft);
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
      relinkCandidate: true,
    });

    return countSqlStatements(() => target.write(plan));
  }

  async function sqlStatementsToCommitCreatedTable(
    rowCount: number,
  ): Promise<number> {
    const draft = await givenCommittedProducts();
    await draft.createTable(CATEGORIES, categorySchema);
    await draft.createRows(
      CATEGORIES,
      Object.fromEntries(
        Array.from({ length: rowCount }, (_, index) => [
          `c${index}`,
          { title: `${index}` },
        ]),
      ),
    );
    const target = new CommitTarget(kit, draft);
    const plan = await target.plan({
      tableId: CATEGORIES,
      outcome: 'base',
      structureSide: 'draft',
      relinkCandidate: true,
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

  function givenCommittedProductsAndCategories(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { code: 'one', price: 1 },
          p2: { code: 'two', price: 2 },
          p3: { code: 'three', price: 3 },
        },
      },
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'one' }, c2: { title: 'two' } },
      },
    });
  }

  async function givenDraftWithEditedPrice(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.updateRow(PRODUCTS, 'p1', { code: 'one', price: 11 });

    return draft;
  }

  async function givenDraftWithEditedPrices(): Promise<ChangesScenario> {
    const draft = await givenDraftWithEditedPrice();
    await draft.updateRow(PRODUCTS, 'p2', { code: 'changed', price: 22 });
    await draft.createRows(PRODUCTS, { p4: { code: 'four', price: 4 } });

    return draft;
  }

  async function givenDraftWithCreatedCategories(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.createTable(CATEGORIES, categorySchema);
    await draft.createRows(CATEGORIES, {
      c1: { title: 'one' },
      c2: { title: 'two' },
    });

    return draft;
  }

  async function givenDraftWithPendingMigrations(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.updateTable(PRODUCTS, [addField('stock', num())]);
    await draft.createTable(CATEGORIES, categorySchema);

    return draft;
  }

  async function givenDraftWithEveryKindOfChange(): Promise<ChangesScenario> {
    const draft = await givenCommittedProductsAndCategories();
    await draft.updateRow(PRODUCTS, 'p1', { code: 'one', price: 11 });
    await draft.createRows(PRODUCTS, { p4: { code: 'four', price: 4 } });
    await draft.removeRow(PRODUCTS, 'p3');
    await draft.renameRow(PRODUCTS, 'p2', 'p5');
    await draft.updateTable(PRODUCTS, [addField('stock', num())]);
    await draft.removeTable(CATEGORIES);
    await draft.createTable(TAGS, categorySchema);
    await draft.createRows(TAGS, { t1: { title: 'one' } });

    return draft;
  }

  async function givenHeadImageWithDraftDroppingTheImageField(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [DOCUMENTS]: {
        schema: documentSchema,
        rows: { d1: { title: 'one', image: emptyFile } },
      },
    });
    await draft.uploadFile(DOCUMENTS, 'd1', 'image');
    await draft.commit();
    await draft.updateTable(DOCUMENTS, [removeField('image')]);

    return draft;
  }

  async function rowVersionsOf(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
  ): Promise<Record<string, string>> {
    const rows = await rowsOf(await draft.tableVersionId(side, tableId));

    return Object.fromEntries(
      Object.values(rows).map((row) => [row.id, row.versionId]),
    );
  }

  async function rowsOf(tableVersionId: string): Promise<Record<string, Row>> {
    const rows = await kit.prisma.row.findMany({
      where: { tables: { some: { versionId: tableVersionId } } },
    });

    return Object.fromEntries(rows.map((row) => [row.id, row]));
  }

  async function rowVersionIdsOf(tableVersionId: string): Promise<string[]> {
    const rows = await rowsOf(tableVersionId);

    return Object.values(rows)
      .map((row) => row.versionId)
      .sort();
  }

  function tableVersion(versionId: string) {
    return kit.prisma.table.findUniqueOrThrow({ where: { versionId } });
  }

  async function readonlyFlagsOf(
    tableVersionId: string,
  ): Promise<{ table: boolean; rows: boolean[] }> {
    const table = await kit.prisma.table.findUniqueOrThrow({
      where: { versionId: tableVersionId },
      select: { readonly: true, rows: { select: { readonly: true } } },
    });

    return {
      table: table.readonly,
      rows: [...new Set(table.rows.map((row) => row.readonly))],
    };
  }

  async function mutableVersionsLinkedBy(
    revisionId: string,
  ): Promise<string[]> {
    const tables = await kit.prisma.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      select: {
        versionId: true,
        readonly: true,
        rows: { where: { readonly: false }, select: { versionId: true } },
      },
    });

    return tables.flatMap((table) => {
      const rows = table.rows.map((row) => row.versionId);

      if (table.readonly) {
        return rows;
      }

      return [table.versionId, ...rows];
    });
  }

  async function tableVersionsLinkedBy(revisionId: string): Promise<string[]> {
    const tables = await kit.prisma.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      select: { versionId: true },
    });

    return tables.map((table) => table.versionId);
  }

  async function rowWritesOf(draft: ChangesScenario): Promise<RowWrites> {
    const rows = await kit.prisma.$queryRaw<
      { versionId: string; writingTransactionId: string }[]
    >`
      SELECT DISTINCT "Row"."versionId", "Row".xmin::text AS "writingTransactionId"
      FROM "Row"
      JOIN "_RowToTable" ON "_RowToTable"."A" = "Row"."versionId"
      JOIN "_RevisionToTable" ON "_RevisionToTable"."B" = "_RowToTable"."B"
      JOIN "Revision" ON "Revision"."id" = "_RevisionToTable"."A"
      WHERE "Revision"."branchId" = ${draft.branchId}
    `;

    return new Map(
      rows.map((row) => [row.versionId, row.writingTransactionId]),
    );
  }

  function revision(revisionId: string) {
    return kit.prisma.revision.findUniqueOrThrow({ where: { id: revisionId } });
  }

  async function hasChanges(draft: ChangesScenario): Promise<boolean> {
    const { hasChanges } = await revision(await draft.revisionId('draft'));

    return hasChanges;
  }

  async function blobIdsOf(rowVersionId: string): Promise<string[]> {
    const row = await kit.prisma.row.findUniqueOrThrow({
      where: { versionId: rowVersionId },
      select: { fileBlobs: { select: { id: true } } },
    });

    return row.fileBlobs.map((blob) => blob.id).sort();
  }

  async function branchContentOf(
    draft: ChangesScenario,
  ): Promise<BranchContent> {
    const head = await draft.revisionId('head');
    const nextDraft = await draft.revisionId('draft');

    return {
      head: await revisionContentOf(head),
      draft: await revisionContentOf(nextDraft),
      draftHasChanges: (await revision(nextDraft)).hasChanges,
    };
  }

  async function revisionContentOf(
    revisionId: string,
  ): Promise<TableContent[]> {
    const tables = await kit.prisma.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      select: {
        id: true,
        system: true,
        readonly: true,
        rows: { orderBy: { id: 'asc' } },
      },
      orderBy: { id: 'asc' },
    });

    return tables.map((table) => ({
      id: table.id,
      system: table.system,
      readonly: table.readonly,
      rows: table.rows.map(rowContentOf),
    }));
  }
});

type RowWrites = Map<string, string>;

interface TableContent {
  readonly id: string;
  readonly system: boolean;
  readonly readonly: boolean;
  readonly rows: readonly JsonValue[];
}

interface BranchContent {
  readonly head: readonly TableContent[];
  readonly draft: readonly TableContent[];
  readonly draftHasChanges: boolean;
}

// Twin branches differ only in when they were built: migration ids, schema history dates and publishedAt.
function rowContentOf(row: Row): JsonValue {
  return withoutTimestamps({
    id: row.id,
    data: row.data,
    meta: row.meta,
    schemaHash: row.schemaHash,
    readonly: row.readonly,
  });
}

function withoutTimestamps(content: JsonValue): JsonValue {
  return JSON.parse(
    JSON.stringify(content).replace(ISO_TIMESTAMP, 'timestamp'),
  ) as JsonValue;
}

function rewrittenSince(before: RowWrites, after: RowWrites): string[] {
  return [...before]
    .filter(
      ([versionId, writingTransactionId]) =>
        after.get(versionId) !== writingTransactionId,
    )
    .map(([versionId]) => versionId)
    .sort();
}

function versionIdsOf(
  rows: Readonly<Record<string, Row>>,
  rowIds: readonly string[],
): Record<string, string | undefined> {
  return Object.fromEntries(
    rowIds.map((rowId) => [rowId, rows[rowId]?.versionId]),
  );
}

function requiredRow(rows: Readonly<Record<string, Row>>, rowId: string): Row {
  const row = rows[rowId];

  if (!row) {
    throw new Error(`Row ${rowId} is missing`);
  }

  return row;
}

function laterId(migrationId: string): string {
  return new Date(Date.parse(migrationId) + 60_000).toISOString();
}

function titled(data: JsonValue, title: string): JsonValue {
  return { ...(data as Record<string, JsonValue>), title };
}
