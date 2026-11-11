import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import {
  queueWriteBehindBranchFence,
  readBranchFenceLocks,
} from 'src/features/draft/commands/handlers/__tests__/support/branch-write-fence';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { recordEndpointNotifications } from 'src/__tests__/fixtures/endpoint-notifications';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  HeldPartialRevert,
  revertOvertakenByAnotherRevert,
  revertWhileNativeWriteLands,
} from '../../__tests__/support/revert-races';
import { expectConsistentRevisions } from '../../__tests__/support/revision-consistency';
import type { RevisionSide } from '../../__tests__/support/snapshot-reading';
import { titleOf } from '../../__tests__/support/field-refs';

const PRODUCTS = 'products';
const TAGS = 'tags';
const ITEMS = 'items';

const pricedSchema = obj({ title: str(), price: num() });
const tagSchema = obj({ title: str() });

const titleOfP1: Selection = { fields: [titleOf(PRODUCTS, 'p1')] };
const titleOfP2: Selection = { fields: [titleOf(PRODUCTS, 'p2')] };
const titlesOfP1AndP2: Selection = {
  fields: [titleOf(PRODUCTS, 'p1'), titleOf(PRODUCTS, 'p2')],
};
const rowP1: Selection = { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] };

describe('revertChanges racing other writers', () => {
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

  describe('a native write', () => {
    it('to the reverted row while the revert planned is kept: the attempt that read the old row is retried and plans with the write', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 11 }),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectDraftData(draft, 'p1', { title: 'one', price: 11 });
    });

    it('that rolls an attempt back leaves one notification, after the attempt that committed', async () => {
      const draft = await givenEditedPrices();
      const notifications = recordEndpointNotifications(kit, () =>
        draftDataOf(draft, 'p1'),
      );

      await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 11 }),
      );

      expect(notifications).toEqual([
        {
          revisionId: await draft.revisionId('draft'),
          seenOutsideTheTransaction: { title: 'one', price: 11 },
        },
      ]);
    });
  });

  describe('a native structural write while the revert planned', () => {
    it('creating a table: the attempt is retried and the Draft keeps the table', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.createTable(TAGS, tagSchema),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectTables(draft, { head: [PRODUCTS], draft: [PRODUCTS, TAGS] });
      await expectDraftData(draft, 'p1', { title: 'one', price: 10 });
      await expectConsistentRevisions(draft);
    });

    it('removing an untouched table: the attempt is retried and the Draft stays without the table', async () => {
      const draft = await givenEditedPricesNextToTags();

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.removeTable(TAGS),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectTables(draft, { head: [PRODUCTS, TAGS], draft: [PRODUCTS] });
      await expectDraftData(draft, 'p1', { title: 'one', price: 10 });
      await expectConsistentRevisions(draft);
    });

    it('patching the schema of the reverted table: the attempt is retried and the Draft keeps the new field', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.updateTable(PRODUCTS, [addField('stock', num())]),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectDraftData(draft, 'p1', { title: 'one', price: 10, stock: 0 });
      await expectData(draft, 'head', PRODUCTS, 'p1', {
        title: 'one',
        price: 1,
      });
      await expectConsistentRevisions(draft);
    });
  });

  describe('a native structural write to the selected table while the revert planned', () => {
    it('removing it: the attempt is retried and the selected field now requires the removal, nothing is written', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.removeTable(PRODUCTS),
      );

      expect(attempts).toBe(2);
      expect(result).toMatchObject({
        status: 'required',
        required: [
          {
            unit: { kind: 'structure', tableId: PRODUCTS },
            reason: { code: 'structureBoundData' },
          },
        ],
      });
      await expectTables(draft, { head: [PRODUCTS], draft: [] });
      await expectConsistentRevisions(draft);
    });

    it('renaming it: the attempt is retried, the selector resolves through the Head id and the field is reverted', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.renameTable(PRODUCTS, ITEMS),
      );

      expect(attempts).toBe(2);
      expect(result).toMatchObject({
        status: 'applied',
        applied: { selected: 1, required: 0 },
        draftHasChanges: true,
      });
      await expectTables(draft, { head: [PRODUCTS], draft: [ITEMS] });
      await expectData(draft, 'draft', ITEMS, 'p1', {
        title: 'one',
        price: 10,
      });
      await expectConsistentRevisions(draft);
    });
  });

  describe('a native commit or whole revert while the revert planned', () => {
    it('a native commit: the attempt is retried, finds nothing left to revert and leaves the new Head as committed', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.commit(),
      );

      expect(attempts).toBe(2);
      expect(result).toEqual<RevertChangesResult>({
        status: 'empty',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: titleOfP1,
      });
      await expectData(draft, 'head', PRODUCTS, 'p1', {
        title: 'uno',
        price: 10,
      });
      await expectConsistentRevisions(draft);
    });

    it('a native whole revert: the attempt is retried and finds nothing left to revert', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.revertNatively(),
      );

      expect(attempts).toBe(2);
      expect(result).toMatchObject({ status: 'empty' });
      await expectDraftData(draft, 'p1', { title: 'one', price: 1 });
      await expectDraftData(draft, 'p2', { title: 'two', price: 2 });
      await expectConsistentRevisions(draft);
    });
  });

  describe('two partial reverts', () => {
    it('of the same field: the overtaken revert re-plans and finds nothing left to revert', async () => {
      const draft = await givenEditedPrices();

      const { overtaken, overtaking } = await revertOvertakenByAnotherRevert(
        kit,
        draft,
        {
          overtaken: { selection: titleOfP1 },
          overtaking: { selection: titleOfP1 },
        },
      );

      expect(overtaking).toMatchObject({ status: 'applied' });
      expect(overtaken).toEqual<RevertChangesResult>({
        status: 'empty',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: titleOfP1,
      });
      await expectDraftData(draft, 'p1', { title: 'one', price: 10 });
    });

    it('of different rows: the overtaken revert re-plans and applies what is left', async () => {
      const draft = await givenEditedPrices();

      const { overtaken, overtaking } = await revertOvertakenByAnotherRevert(
        kit,
        draft,
        {
          overtaken: { selection: titleOfP2 },
          overtaking: { selection: titleOfP1 },
        },
      );

      expect(overtaking).toMatchObject({ status: 'applied' });
      expect(overtaken).toMatchObject({
        status: 'applied',
        applied: { selected: 1, required: 0 },
        draftHasChanges: true,
      });
      await expectDraftData(draft, 'p1', { title: 'one', price: 10 });
      await expectDraftData(draft, 'p2', { title: 'two', price: 2 });
    });

    it('with overlapping selections: the overtaken revert is blocked by the selector the other one used up', async () => {
      const draft = await givenEditedPrices();

      const { overtaken } = await revertOvertakenByAnotherRevert(kit, draft, {
        overtaken: { selection: titlesOfP1AndP2 },
        overtaking: { selection: titleOfP1 },
      });

      expect(overtaken).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'unmatchedSelector' }],
        unmatched: titleOfP1,
      });
      await expectDraftData(draft, 'p2', { title: 'dos', price: 2 });
    });

    it('with overlapping selections and expected: the overtaken revert is stale', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: titlesOfP1AndP2,
      });

      const { overtaken } = await revertOvertakenByAnotherRevert(kit, draft, {
        overtaken: {
          selection: titlesOfP1AndP2,
          expected: preview.fingerprint,
        },
        overtaking: { selection: titleOfP1 },
      });

      expect(overtaken).toEqual<RevertChangesResult>({
        status: 'stale',
        changed: ['units'],
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: titleOfP1,
      });
      await expectDraftData(draft, 'p2', { title: 'dos', price: 2 });
    });

    it('identical with expected, of a field: one applies and the other finds nothing left to revert', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: titleOfP1,
      });
      const revert = { selection: titleOfP1, expected: preview.fingerprint };

      const { overtaken, overtaking } = await revertOvertakenByAnotherRevert(
        kit,
        draft,
        { overtaken: revert, overtaking: revert },
      );

      expect(overtaking).toMatchObject({ status: 'applied' });
      expect(overtaken).toMatchObject({ status: 'empty' });
      await expectDraftData(draft, 'p1', { title: 'one', price: 10 });
    });

    it('identical with expected, of a row whose id a rename freed: one applies and the other is stale instead of reverting the rename', async () => {
      const draft = await givenRowIdReusedAfterItsRename();
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: rowP1,
      });
      const revert = { selection: rowP1, expected: preview.fingerprint };

      const { overtaken, overtaking } = await revertOvertakenByAnotherRevert(
        kit,
        draft,
        { overtaken: revert, overtaking: revert },
      );

      expect(overtaking).toMatchObject({ status: 'applied' });
      expect(overtaken).toEqual<RevertChangesResult>({
        status: 'stale',
        changed: ['units'],
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: {},
      });
      expect(await draft.rowIds('draft', PRODUCTS)).toEqual(['p2', 'p9']);
    });
  });

  describe('the branch write fence', () => {
    it('is entered shared like by every Draft writer: the revert waits behind an exclusive holder and applies after it', async () => {
      const draft = await givenEditedPrices();

      const queued = await queueWriteBehindBranchFence(
        { prismaService: kit.prisma },
        draft.branchId,
        () => draft.revertChanges({ selection: titleOfP1 }),
      );
      await queued.releaseFence();

      await expect(queued.writing).resolves.toMatchObject({
        status: 'applied',
      });
      await expectDraftData(draft, 'p1', { title: 'one', price: 10 });
    });
  });

  describe('under continuous native writers', () => {
    it('a revert that loses two attempts takes the branch fence exclusively: the next writer waits until it applies, and every write is kept', async () => {
      const draft = await givenEditedPrices();
      const revert = new HeldPartialRevert(kit, draft, {
        selection: titleOfP1,
      });

      await revert.losesAttemptTo(() =>
        draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 11 }),
      );
      await revert.losesAttemptTo(() =>
        draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 12 }),
      );
      const queued = await revert.queuesBehindFence(() =>
        draft.updateRow(PRODUCTS, 'p2', { title: 'dos!', price: 2 }),
      );

      await expect(revert.outcome()).resolves.toMatchObject({
        status: 'applied',
      });
      await queued.writing;
      await expectDraftData(draft, 'p1', { title: 'one', price: 12 });
      await expectDraftData(draft, 'p2', { title: 'dos!', price: 2 });
      await expect(
        readBranchFenceLocks({ prismaService: kit.prisma }, draft.branchId),
      ).resolves.toEqual([]);
    });
  });

  async function expectTables(
    draft: ChangesScenario,
    tables: Readonly<Record<RevisionSide, readonly string[]>>,
  ): Promise<void> {
    for (const side of ['head', 'draft'] as const) {
      const identities = await draft.userTables(side);

      expect(identities.map(({ id }) => id)).toEqual(tables[side]);
    }
  }

  async function expectData(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
    rowId: string,
    data: JsonValue,
  ): Promise<void> {
    const row = await draft.row(side, tableId, rowId);

    expect(row.data).toEqual(data);
  }

  async function expectDraftData(
    draft: ChangesScenario,
    rowId: string,
    data: JsonValue,
  ): Promise<void> {
    expect(await draftDataOf(draft, rowId)).toEqual(data);
  }

  async function draftDataOf(
    draft: ChangesScenario,
    rowId: string,
  ): Promise<JsonValue> {
    const row = await draft.row('draft', PRODUCTS, rowId);

    return row.data;
  }

  async function givenRowIdReusedAfterItsRename(): Promise<ChangesScenario> {
    const draft = await givenCommittedPrices();
    await draft.renameRow(PRODUCTS, 'p1', 'p9');
    await draft.createRows(PRODUCTS, { p1: { title: 'new one', price: 5 } });

    return draft;
  }

  async function givenEditedPricesNextToTags(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
      [TAGS]: { schema: tagSchema, rows: { t1: { title: 'one' } } },
    });
    await editPrices(draft);

    return draft;
  }

  async function givenEditedPrices(): Promise<ChangesScenario> {
    const draft = await givenCommittedPrices();
    await editPrices(draft);

    return draft;
  }

  async function editPrices(draft: ChangesScenario): Promise<void> {
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });
    await draft.updateRow(PRODUCTS, 'p2', { title: 'dos', price: 2 });
  }

  function givenCommittedPrices(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
    });
  }
});
