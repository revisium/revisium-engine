import { BadRequestException, NotFoundException } from '@nestjs/common';
import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  DamageShape,
  FindingRole,
  RowDiagnostics,
  ScanSchemaLedgerData,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import type * as SchemaChecksModule from 'src/features/migration/ledger-scan/schema-checks';
import type * as LedgerReplayModule from 'src/features/share/ledger-replay/ledger-replay';
import {
  ChangesScenario,
  type TableFixture,
} from 'src/features/partial-changes/__tests__/support/changes-scenario';
import { completeAsyncMigrationInPlace } from 'src/features/partial-changes/__tests__/support/head-schema-damage';
import {
  addField,
  moveField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  branchContentsOf,
  givenActiveMigration,
  initAt,
  planRepair,
  writeRowWithoutValidation,
} from './support/ledger-repair-planning';
import {
  committedRevisionIds,
  createBranchFromHead,
  damagedTableRepairsOf,
  dropPendingMigration,
  findingAt,
  findingOf,
  findingsOf,
  hashOf,
  isStoredLedgerReplay,
  ledgerReplaysDuring,
  pendingMigrationOf,
  removeSchemaRow,
  rowHashClassificationsDuring,
  removeSchemaTable,
  rowSchemaHashOf,
  scanBranch,
  scanLedgers,
  scanProject,
  scanProjectPages,
  schemaRowHashOf,
  sortedByHash,
  storedHeadLedgerOf,
  transactionModesDuring,
  userTableVersionCountOf,
} from './support/ledger-scan';

jest.mock('src/features/share/ledger-replay/ledger-replay', () => {
  const actual: typeof LedgerReplayModule = jest.requireActual(
    'src/features/share/ledger-replay/ledger-replay',
  );

  return { ...actual, replayLedger: jest.fn(actual.replayLedger) };
});

jest.mock('src/features/migration/ledger-scan/schema-checks', () => {
  const actual: typeof SchemaChecksModule = jest.requireActual(
    'src/features/migration/ledger-scan/schema-checks',
  );

  return { ...actual, rowHashReasonOf: jest.fn(actual.rowHashReasonOf) };
});

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const GOODS = 'goods';
const TAGS = 'tags';
const LABELS = 'labels';
const GROUPS = 'groups';
const NOTES = 'notes';
const LATER_MIGRATION_ID = '2999-01-01T00:00:00.000Z';
const COLOR = 'color';
const SHADE = 'shade';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  code: str(),
  category: str({ foreignKey: CATEGORIES }),
});
const tagSchema = obj({ label: str() });
const taggedNoteSchema = obj({ text: str(), tag: str({ foreignKey: TAGS }) });

const categories: TableFixture = {
  schema: categorySchema,
  rows: { c1: { title: 'first' } },
};
const products: TableFixture = {
  schema: productSchema,
  rows: {
    p1: { code: 'one', category: 'c1' },
    p2: { code: 'two', category: 'c1' },
  },
};
const tags: TableFixture = { schema: tagSchema, rows: { t1: { label: 'x' } } };

const addColor = [addField(COLOR, str())];
const addTone = [addField('tone', str())];
const addWeight = [addField('weight', num())];
const addNote = [addField('note', str())];

const READ_ONLY_REPEATABLE_READ = {
  readOnly: 'on',
  isolation: 'repeatable read',
};

interface LedgeredCase {
  readonly table: string;
  readonly given: () => Promise<ChangesScenario>;
}

interface ShapeCase {
  readonly rows: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly rowDiagnostics: RowDiagnostics;
  readonly shape: DamageShape;
}

interface RowDiagnosticsCase {
  readonly rowDiagnostics: RowDiagnostics;
  readonly roles: FindingRole[];
}

interface TrailCase {
  readonly rowDiagnostics: RowDiagnostics;
  readonly recordsTrail: boolean;
}

interface HeadCounterpartCase {
  readonly head: string;
  readonly given: () => Promise<ChangesScenario>;
}

interface InvalidRequestCase {
  readonly request: string;
  readonly data: ScanSchemaLedgerData;
}

describe('Schema ledger scan', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('table identity', () => {
    it.each<LedgeredCase>([
      { table: 'a table created by init', given: givenCommittedCatalog },
      {
        table: 'a table renamed through recorded migrations',
        given: givenRenamedProducts,
      },
    ])('reports nothing for $table', async ({ given }) => {
      const draft = await given();

      const scan = await scanBranch(kit, draft);

      expect(scan.findings).toEqual([]);
    });

    it('reports every table of a branch without a migration table as unledgered', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [CATEGORIES]: categories,
      });

      const scan = await scanBranch(kit, draft);

      const unledgered = {
        code: 'unledgeredTable',
        tableId: CATEGORIES,
        detail: { reason: 'noMigrationTable' },
      } as const;
      expect(scan.findings).toEqual([
        await findingAt(draft, 'head', unledgered),
        await findingAt(draft, 'draft', unledgered),
      ]);
    });

    it('reports a table of a branch with neither a schema table nor a migration table as unledgered', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [CATEGORIES]: categories,
      });
      await removeSchemaTable(kit, draft);

      const scan = await scanBranch(kit, draft);

      const unledgered = {
        code: 'unledgeredTable',
        tableId: CATEGORIES,
        detail: { reason: 'noMigrationTable' },
      } as const;
      expect(scan.findings).toEqual([
        await findingAt(draft, 'head', unledgered),
        await findingAt(draft, 'draft', unledgered),
      ]);
    });

    it('reports a removed table recreated without a recorded init as having no lineage', async () => {
      const draft = await givenProductsRecreatedWithoutInit();

      const scan = await scanBranch(kit, draft);

      expect(scan.findings).toEqual([
        await findingAt(draft, 'draft', {
          code: 'unledgeredTable',
          tableId: PRODUCTS,
          detail: { reason: 'noLineage' },
        }),
      ]);
    });

    it('reports a table that an unattributable rename produced as having a broken lineage', async () => {
      const draft = await givenLabelsFromUnattributableRename();
      const rename = await pendingMigrationOf(draft, 'rename', TAGS);

      const scan = await scanBranch(kit, draft);

      expect(scan.findings).toEqual([
        await findingAt(draft, 'draft', {
          code: 'unledgeredTable',
          tableId: LABELS,
          detail: { reason: 'brokenLineage', migrationId: rename.id },
        }),
      ]);
    });

    it('reports a table whose rename read an unreplayable referrer as unreplayable under its new id', async () => {
      const draft = await givenTagsRenamedBesideUnreplayableNotes();
      const rename = await pendingMigrationOf(draft, 'rename', TAGS);

      const scan = await scanBranch(kit, draft);

      expect(findingsOf(scan, LABELS)).toEqual([
        await findingAt(draft, 'draft', {
          code: 'unreplayableLedger',
          tableId: LABELS,
          detail: {
            migrationId: rename.id,
            step: 'rename',
            error: `Depends on unreplayable table "${NOTES}"`,
          },
        }),
      ]);
    });
  });

  describe('schema damage', () => {
    it.each<ShapeCase>([
      {
        rows: 'not migrated',
        given: givenUnpublishedInPlaceMigration,
        rowDiagnostics: 'headAndDraft',
        shape: 'unpublished',
      },
      {
        rows: 'migrated by a later commit',
        given: givenPublishedInPlaceMigration,
        rowDiagnostics: 'headAndDraft',
        shape: 'published',
      },
      {
        rows: 'absent',
        given: givenDamagedEmptyProducts,
        rowDiagnostics: 'headAndDraft',
        shape: 'unknown',
      },
      {
        rows: 'not migrated',
        given: givenUnpublishedInPlaceMigration,
        rowDiagnostics: 'none',
        shape: 'unpublished',
      },
      {
        rows: 'absent',
        given: givenDamagedEmptyProducts,
        rowDiagnostics: 'none',
        shape: 'unknown',
      },
    ])(
      'reports a damaged Head table whose rows are $rows as $shape with rowDiagnostics $rowDiagnostics',
      async ({ given, rowDiagnostics, shape }) => {
        const draft = await given();

        const scan = await scanBranch(kit, draft, { rowDiagnostics });

        expect(findingsOf(scan, PRODUCTS)).toContainEqual(
          await findingAt(draft, 'head', {
            code: 'damagedTable',
            tableId: PRODUCTS,
            detail: { shape, repair: 'repaired' },
          }),
        );
      },
    );

    it('reports a ledgered Head table without a schema row as damaged with an unknown shape', async () => {
      const draft = await givenCommittedCatalog();
      await removeSchemaRow(kit, draft, PRODUCTS);

      const scan = await scanBranch(kit, draft);

      expect(scan.findings).toEqual([
        await findingAt(draft, 'head', {
          code: 'damagedTable',
          tableId: PRODUCTS,
          detail: { shape: 'unknown', repair: 'needsDraftStructureRevert' },
        }),
      ]);
    });

    it('reports a Draft whose own schema row an async migration rewrote as Draft-only damage', async () => {
      const draft = await givenDraftOnlyDamage();

      const scan = await scanBranch(kit, draft);

      expect(scan.findings).toEqual([
        await findingAt(draft, 'draft', {
          code: 'draftOnlyDamage',
          tableId: PRODUCTS,
          detail: {},
        }),
      ]);
    });

    it.each<HeadCounterpartCase>([
      {
        head: 'unreplayable',
        given: givenUnreplayableHeadAndDraftWithoutTheFailingUpdate,
      },
      {
        head: 'unledgered',
        given: givenUnledgeredHeadAndDraftWithAnInit,
      },
    ])(
      'leaves a failing Draft table out of Draft-only damage while its Head table is $head',
      async ({ given }) => {
        const draft = await given();

        const scan = await scanBranch(kit, draft);

        expect(
          findingsOf(scan, PRODUCTS).filter(({ role }) => role === 'draft'),
        ).toEqual([]);
      },
    );

    it('reports an earlier revision whose ledger does not reproduce its schema as damaged history', async () => {
      const draft = await givenPublishedInPlaceMigration();
      const [, damagedRevisionId = ''] = await committedRevisionIds(kit, draft);

      const scan = await scanBranch(kit, draft);

      expect(findingsOf(scan, PRODUCTS)).toEqual([
        await findingAt(draft, 'head', {
          code: 'damagedTable',
          tableId: PRODUCTS,
          detail: { shape: 'published', repair: 'repaired' },
        }),
        findingOf(draft, 'history', [damagedRevisionId], {
          code: 'damagedHistory',
          tableId: PRODUCTS,
          detail: {},
        }),
      ]);
    });

    it('evaluates ten revisions that share one ledger and one schema version once and reports them in one finding', async () => {
      const draft = await givenDamageSharedByTenCommits();
      const committed = await committedRevisionIds(kit, draft);

      const scan = await scanBranch(kit, draft);

      expect(
        findingsOf(scan, PRODUCTS).filter(({ role }) => role === 'history'),
      ).toEqual([
        findingOf(draft, 'history', committed.slice(1, -1), {
          code: 'damagedHistory',
          tableId: PRODUCTS,
          detail: {},
        }),
      ]);
      expect(scan.stats).toEqual({
        branches: 1,
        revisions: 13,
        ledgerReplays: 1,
        schemaTableReads: 1,
        schemaChecks: 2,
        rowHashReads: 2,
      });
    });
  });

  describe('repair outcomes', () => {
    it('reports the outcome the repair planner plans for each damaged Head table of the branch', async () => {
      const draft = await givenTwoDamagedTablesWithInvalidTagRows();

      const scan = await scanBranch(kit, draft);

      const plan = await planRepair(kit, draft);
      expect(damagedTableRepairsOf(scan)).toEqual(
        plan.tables.map(({ tableId, outcome }) => [tableId, outcome]),
      );
      expect(damagedTableRepairsOf(scan)).toEqual([
        [PRODUCTS, 'repaired'],
        [TAGS, 'rowsNeedMigration'],
      ]);
    });

    it('replays a stored ledger that ten damaged branches share once and plans their repairs on that replay', async () => {
      const draft = await givenTenDamagedBranchesSharingOneLedger();
      const storedLedger = await storedHeadLedgerOf(draft);

      const { result: scan, replays } = await ledgerReplaysDuring(() =>
        scanProject(kit, draft),
      );

      const storedReplays = replays.filter((replay) =>
        isStoredLedgerReplay(replay, storedLedger),
      );
      expect(storedReplays).toHaveLength(1);
      expect(scan.stats).toMatchObject({ branches: 10, ledgerReplays: 1 });
      expect(replays.length).toBeGreaterThan(storedReplays.length);
    });

    it('defers the repair of a damaged Head table while an async migration is active on the branch', async () => {
      const draft = await givenUnpublishedInPlaceMigration();
      await givenActiveMigration(kit, draft, CATEGORIES);

      const scan = await scanBranch(kit, draft, { rowDiagnostics: 'none' });

      expect(scan.findings).toEqual([
        await findingAt(draft, 'head', {
          code: 'damagedTable',
          tableId: PRODUCTS,
          detail: { shape: 'unpublished', repair: 'deferred' },
        }),
      ]);
    });
  });

  describe('row schema hashes', () => {
    it('classifies rows an async migration left behind under the rewritten schema row', async () => {
      const draft = await givenUnpublishedInPlaceMigration();

      const scan = await scanBranch(kit, draft);

      expect(findingsOf(scan, PRODUCTS)).toEqual([
        await findingAt(draft, 'head', {
          code: 'damagedTable',
          tableId: PRODUCTS,
          detail: { shape: 'unpublished', repair: 'repaired' },
        }),
        await findingAt(draft, 'head', {
          code: 'rowSchemaHashMismatch',
          tableId: PRODUCTS,
          detail: {
            schemaHash: await schemaRowHashOf(draft, 'head', PRODUCTS),
            rowHashes: [
              {
                hash: hashOf(productSchema),
                rowCount: 2,
                reason: 'unmigratedByAsync',
              },
            ],
          },
        }),
      ]);
    });

    it('classifies rows behind an own step and rows behind a referenced table rename in one table', async () => {
      const draft = await givenRowsBehindOwnStepAndRename();
      const weightedHash = await rowSchemaHashOf(draft, PRODUCTS, 'p2');

      const scan = await scanBranch(kit, draft);

      expect(scan.findings).toEqual([
        await findingAt(draft, 'draft', {
          code: 'rowSchemaHashMismatch',
          tableId: PRODUCTS,
          detail: {
            schemaHash: await schemaRowHashOf(draft, 'draft', PRODUCTS),
            rowHashes: sortedByHash([
              {
                hash: hashOf(productSchema),
                rowCount: 1,
                reason: 'unmigratedRows',
              },
              { hash: weightedHash, rowCount: 1, reason: 'renamedReference' },
            ]),
          },
        }),
      ]);
    });

    it('classifies a row hash outside the ledger trail as unknown', async () => {
      const draft = await givenCommittedCatalog();
      await draft.writeRowColumns(PRODUCTS, 'p1', { schemaHash: '' });

      const scan = await scanBranch(kit, draft);

      expect(scan.findings).toEqual([
        await findingAt(draft, 'draft', {
          code: 'rowSchemaHashMismatch',
          tableId: PRODUCTS,
          detail: {
            schemaHash: await schemaRowHashOf(draft, 'draft', PRODUCTS),
            rowHashes: [{ hash: '', rowCount: 1, reason: 'unknownHash' }],
          },
        }),
      ]);
    });

    it.each<RowDiagnosticsCase>([
      { rowDiagnostics: 'none', roles: [] },
      { rowDiagnostics: 'headAndDraft', roles: ['draft'] },
      { rowDiagnostics: 'all', roles: ['draft', 'history'] },
    ])(
      'checks row schema hashes in the $roles revisions with rowDiagnostics $rowDiagnostics',
      async ({ rowDiagnostics, roles }) => {
        const draft = await givenRowMismatchesInDraftAndHistory();

        const scan = await scanBranch(kit, draft, { rowDiagnostics });

        expect(
          scan.findings
            .filter(({ code }) => code === 'rowSchemaHashMismatch')
            .map(({ role }) => role),
        ).toEqual(roles);
      },
    );
    it('classifies the row hashes of a table version once per ledger however many revisions share them', async () => {
      const draft = await givenUnknownRowHashSharedByTenCommits();

      const { result: scan, classifications } =
        await rowHashClassificationsDuring(() =>
          scanBranch(kit, draft, { rowDiagnostics: 'all' }),
        );

      const mismatches = findingsOf(scan, PRODUCTS).filter(
        ({ code }) => code === 'rowSchemaHashMismatch',
      );
      expect(mismatches.flatMap(({ revisionIds }) => revisionIds)).toHaveLength(
        12,
      );
      expect(classifications).toBe(2);
    });

    it('checks the rows of each table version once however many revisions link it', async () => {
      const draft = await givenDamageSharedByTenCommits();

      const scan = await scanBranch(kit, draft, { rowDiagnostics: 'all' });

      expect(scan.stats.rowHashReads).toBe(
        await userTableVersionCountOf(kit, draft),
      );
    });

    it.each<TrailCase>([
      { rowDiagnostics: 'none', recordsTrail: false },
      { rowDiagnostics: 'headAndDraft', recordsTrail: true },
    ])(
      'records ledger trails with rowDiagnostics $rowDiagnostics: $recordsTrail',
      async ({ rowDiagnostics, recordsTrail }) => {
        const draft = await givenUnpublishedInPlaceMigration();
        const storedLedger = await storedHeadLedgerOf(draft);

        const { replays } = await ledgerReplaysDuring(() =>
          scanBranch(kit, draft, { rowDiagnostics }),
        );

        expect(
          replays
            .filter((replay) => isStoredLedgerReplay(replay, storedLedger))
            .map(({ recordTrail }) => recordTrail === true),
        ).toEqual([recordsTrail]);
      },
    );
  });

  describe('paging', () => {
    it('pages through the branches of a project in code-point order and finds what one call finds', async () => {
      const draft = await givenDamagedProjectWithThreeBranches();

      const pages = await scanProjectPages(kit, draft, 1);

      const whole = await scanProject(kit, draft);
      expect(pages.flatMap(({ findings }) => findings)).toEqual(whole.findings);
      expect(pages.map(({ findings }) => findings[0]?.branchName)).toEqual([
        'Zeta',
        'alpha',
        draft.branch.branchName,
      ]);
    });

    it('continues across every project after the cursor of a page', async () => {
      const draft = await givenDamagedProjectWithThreeBranches();
      const firstPage = await scanProject(kit, draft, { limit: 1 });

      const nextPage = await scanLedgers(kit, {
        cursor: firstPage.nextCursor ?? undefined,
        limit: 1,
      });

      const alpha = await scanLedgers(kit, {
        projectId: draft.branch.projectId,
        branchName: 'alpha',
      });
      expect(nextPage.findings).toEqual(alpha.findings);
      expect(nextPage.findings).not.toEqual([]);
    });
  });

  describe('reading', () => {
    it('changes nothing and reads the branch in one read-only RepeatableRead transaction', async () => {
      const draft = await givenUnpublishedInPlaceMigration();
      await draft.updateTable(CATEGORIES, addNote);
      const before = await branchContentsOf(kit, draft);

      const modes = await transactionModesDuring(kit, () =>
        scanBranch(kit, draft, { rowDiagnostics: 'all' }),
      );

      expect(await branchContentsOf(kit, draft)).toEqual(before);
      expect(modes).toEqual([READ_ONLY_REPEATABLE_READ]);
    });
  });

  describe('request validation', () => {
    it.each<InvalidRequestCase>([
      {
        request: 'a branch name without a project',
        data: { branchName: 'master' },
      },
      { request: 'a malformed cursor', data: { cursor: 'not-a-cursor' } },
      { request: 'a limit below one', data: { limit: 0 } },
      { request: 'a limit above one thousand', data: { limit: 1001 } },
      { request: 'a fractional limit', data: { limit: 1.5 } },
      {
        request: 'an unknown row diagnostics mode',
        data: { rowDiagnostics: 'some' as RowDiagnostics },
      },
    ])('rejects $request', async ({ data }) => {
      await expect(scanLedgers(kit, data)).rejects.toThrow(BadRequestException);
    });

    it('reports an unknown project as not found', async () => {
      const draft = await givenCommittedCatalog();

      await expect(
        scanLedgers(kit, { projectId: `${draft.branch.projectId}-missing` }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reports an unknown branch as not found', async () => {
      const draft = await givenCommittedCatalog();

      await expect(
        scanLedgers(kit, {
          projectId: draft.branch.projectId,
          branchName: 'missing',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  function givenCommittedCatalog(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
    });
  }

  async function givenRenamedProducts(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.renameTable(PRODUCTS, GOODS);
    await draft.commit();

    return draft;
  }

  async function givenProductsRecreatedWithoutInit(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.removeTable(PRODUCTS);
    await draft.commit();
    await draft.createTable(PRODUCTS, productSchema);
    await dropPendingMigration(kit, draft, 'init', PRODUCTS);

    return draft;
  }

  async function givenLabelsFromUnattributableRename(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.createTable(TAGS, tagSchema);
    await dropPendingMigration(kit, draft, 'init', TAGS);
    await draft.renameTable(TAGS, LABELS);

    return draft;
  }

  async function givenTagsRenamedBesideUnreplayableNotes(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [TAGS]: tags,
      [NOTES]: { schema: taggedNoteSchema },
    });
    await completeAsyncMigrationInPlace(kit, draft, NOTES, addColor);
    await draft.updateTable(NOTES, [moveField(COLOR, SHADE)]);
    await draft.renameTable(TAGS, LABELS);

    return draft;
  }

  async function givenUnpublishedInPlaceMigration(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenPublishedInPlaceMigration(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration();
    await draft.commit();

    return draft;
  }

  async function givenDamagedEmptyProducts(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: { schema: productSchema },
    });
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenDraftOnlyDamage(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.updateTable(PRODUCTS, addWeight);
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

    return draft;
  }

  async function givenUnreplayableHeadAndDraftWithoutTheFailingUpdate(): Promise<ChangesScenario> {
    const draft = await givenPublishedInPlaceMigration();
    await draft.updateTable(PRODUCTS, [moveField(COLOR, SHADE)]);
    await draft.commit();
    await draft.dropFromDraftLedger('update', PRODUCTS);

    return draft;
  }

  async function givenUnledgeredHeadAndDraftWithAnInit(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
    });
    await draft.createTable(PRODUCTS, productSchema);
    await dropPendingMigration(kit, draft, 'init', PRODUCTS);
    await draft.commit();
    await draft.recordPendingMigration(
      initAt(LATER_MIGRATION_ID, PRODUCTS, obj({ code: str() })),
    );

    return draft;
  }

  async function givenTenDamagedBranchesSharingOneLedger(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration();

    for (let branch = 1; branch < 10; branch++) {
      await createBranchFromHead(kit, draft, `branch-${branch}`);
    }

    return draft;
  }

  async function givenDamageSharedByTenCommits(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration();

    for (let commit = 1; commit <= 10; commit++) {
      await draft.updateRow(CATEGORIES, 'c1', { title: `title ${commit}` });
      await draft.commit();
    }

    return draft;
  }

  async function givenTwoDamagedTablesWithInvalidTagRows(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
      [TAGS]: tags,
    });
    await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
    await completeAsyncMigrationInPlace(kit, draft, TAGS, addTone);
    await writeRowWithoutValidation(kit, draft, TAGS, 't1', { label: 'x' });

    return draft;
  }

  async function givenRowsBehindOwnStepAndRename(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.updateTable(PRODUCTS, addWeight);
    await draft.renameTable(CATEGORIES, GROUPS);
    await draft.writeRowColumns(PRODUCTS, 'p1', {
      schemaHash: hashOf(productSchema),
    });

    return draft;
  }

  async function givenUnknownRowHashSharedByTenCommits(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.writeRowColumns(PRODUCTS, 'p1', { schemaHash: '' });
    await draft.commit();

    for (let commit = 1; commit <= 10; commit++) {
      await draft.updateRow(CATEGORIES, 'c1', { title: `title ${commit}` });
      await draft.commit();
    }

    await draft.updateTable(CATEGORIES, addNote);

    return draft;
  }

  async function givenRowMismatchesInDraftAndHistory(): Promise<ChangesScenario> {
    const draft = await givenPublishedInPlaceMigration();
    await draft.writeRowColumns(PRODUCTS, 'p1', { schemaHash: '' });

    return draft;
  }

  async function givenDamagedProjectWithThreeBranches(): Promise<ChangesScenario> {
    const draft = await givenUnpublishedInPlaceMigration();
    await createBranchFromHead(kit, draft, 'alpha');
    await createBranchFromHead(kit, draft, 'Zeta');

    return draft;
  }
});
