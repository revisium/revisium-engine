import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import type {
  CommitChangesResult,
  CommittedDraft,
} from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { recordEndpointNotifications } from '../../__tests__/support/change-reverting';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  commitOvertakenBy,
  commitWhileNativeWriteLands,
} from '../../__tests__/support/commit-races';
import { expectConsistentRevisions } from '../../__tests__/support/revision-consistency';
import type { RevisionSide } from '../../__tests__/support/snapshot-reading';

const PRODUCTS = 'products';
const TAGS = 'tags';
const LABELS = 'labels';

const pricedSchema = obj({ title: str(), price: num() });
const tagSchema = obj({ title: str() });

const titleOf = (rowId: string): FieldRef => ({
  tableId: PRODUCTS,
  rowId,
  path: '/title',
});

const titleOfP1: Selection = { fields: [titleOf('p1')] };
const titleOfP2: Selection = { fields: [titleOf('p2')] };
const titlesOfP1AndP2: Selection = { fields: [titleOf('p1'), titleOf('p2')] };

describe('commitChanges racing other writers', () => {
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
    it('to the committed row while the commit planned is committed with its latest value: the attempt that read the old row is retried', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.updateRow(PRODUCTS, 'p1', { title: 'uno!', price: 11 }),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectData(draft, 'head', PRODUCTS, 'p1', {
        title: 'uno!',
        price: 1,
      });
      await expectData(draft, 'draft', PRODUCTS, 'p1', {
        title: 'uno!',
        price: 11,
      });
    });

    it('to an untouched table while the commit planned is kept in the new Draft and stays out of Head', async () => {
      const draft = await givenEditedPricesNextToTags();

      const { result } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.updateRow(TAGS, 't1', { title: 'renamed' }),
      );

      expect(result).toMatchObject({ status: 'applied' });
      await expectData(draft, 'draft', TAGS, 't1', { title: 'renamed' });
      await expectData(draft, 'head', TAGS, 't1', { title: 'one' });
    });

    it('that rolls an attempt back leaves one notification of each revision, after the attempt that committed', async () => {
      const draft = await givenEditedPrices();
      const notifications = recordEndpointNotifications(kit, () =>
        dataOf(draft, 'head', PRODUCTS, 'p1'),
      );

      const { result } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.updateRow(PRODUCTS, 'p1', { title: 'uno!', price: 11 }),
      );

      expectCommitted(result);
      const seenOutsideTheTransaction = { title: 'uno!', price: 1 };
      expect(notifications).toEqual([
        { revisionId: result.headRevisionId, seenOutsideTheTransaction },
        { revisionId: result.draftRevisionId, seenOutsideTheTransaction },
      ]);
    });
  });

  describe('a native structural write while the commit planned', () => {
    it('creating a table: the attempt is retried, Head stays without the table and the new Draft keeps it', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.createTable(TAGS, tagSchema),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectTables(draft, { head: [PRODUCTS], draft: [PRODUCTS, TAGS] });
      await expectData(draft, 'head', PRODUCTS, 'p1', {
        title: 'uno',
        price: 1,
      });
      await expectConsistentRevisions(draft);
    });

    it('removing an untouched table: the attempt is retried, Head keeps the table and the new Draft stays without it', async () => {
      const draft = await givenEditedPricesNextToTags();

      const { result, attempts } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.removeTable(TAGS),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectTables(draft, { head: [PRODUCTS, TAGS], draft: [PRODUCTS] });
      await expectData(draft, 'head', TAGS, 't1', { title: 'one' });
      await expectConsistentRevisions(draft);
    });

    it('renaming an untouched table: the attempt is retried, Head keeps the old name and the new Draft the new one', async () => {
      const draft = await givenEditedPricesNextToTags();

      const { result, attempts } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.renameTable(TAGS, LABELS),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectTables(draft, {
        head: [PRODUCTS, TAGS],
        draft: [LABELS, PRODUCTS],
      });
      await expectData(draft, 'draft', LABELS, 't1', { title: 'one' });
      await expectConsistentRevisions(draft);
    });

    it('patching the schema of the committed table: the attempt is retried, Head keeps its schema and the new Draft the new field', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.updateTable(PRODUCTS, [addField('stock', num())]),
      );

      expect(result).toMatchObject({ status: 'applied' });
      expect(attempts).toBe(2);
      await expectData(draft, 'head', PRODUCTS, 'p1', {
        title: 'uno',
        price: 1,
      });
      await expectData(draft, 'draft', PRODUCTS, 'p1', {
        title: 'uno',
        price: 10,
        stock: 0,
      });
      await expectConsistentRevisions(draft);
    });
  });

  describe('a native commit or whole revert while the commit planned', () => {
    it('a native commit: the attempt is retried and finds nothing left to commit in the next Draft', async () => {
      const draft = await givenEditedPrices();

      const { result, attempts } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.commit(),
      );

      expect(attempts).toBe(2);
      expect(result).toEqual<CommitChangesResult>({
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

    it('a native whole revert: the attempt is retried and finds nothing left to commit, Head stays as it was', async () => {
      const draft = await givenEditedPrices();
      const headRevisionId = await draft.revisionId('head');

      const { result, attempts } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.revertNatively(),
      );

      expect(attempts).toBe(2);
      expect(result).toMatchObject({ status: 'empty', headRevisionId });
      await expectData(draft, 'head', PRODUCTS, 'p1', {
        title: 'one',
        price: 1,
      });
      await expectData(draft, 'draft', PRODUCTS, 'p1', {
        title: 'one',
        price: 1,
      });
      await expectConsistentRevisions(draft);
    });
  });

  describe('two partial commits', () => {
    it('of different rows: the overtaken commit re-plans and applies what is left as the next revision', async () => {
      const draft = await givenEditedPrices();

      const { overtaken, overtaking } = await commitOvertakenBy(
        kit,
        draft,
        { selection: titleOfP2 },
        () => draft.commitChanges({ selection: titleOfP1 }),
      );

      expectCommitted(overtaking);
      expect(overtaken).toMatchObject({
        status: 'applied',
        previousHeadRevisionId: overtaking.headRevisionId,
        headRevisionId: overtaking.draftRevisionId,
        applied: { selected: 1, required: 0 },
        draftHasChanges: true,
      });
      await expectData(draft, 'head', PRODUCTS, 'p1', {
        title: 'uno',
        price: 1,
      });
      await expectData(draft, 'head', PRODUCTS, 'p2', {
        title: 'dos',
        price: 2,
      });
    });

    it('of the same field: the overtaken commit re-plans and finds nothing left to commit', async () => {
      const draft = await givenEditedPrices();

      const { overtaken, overtaking } = await commitOvertakenBy(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.commitChanges({ selection: titleOfP1 }),
      );

      expect(overtaking).toMatchObject({ status: 'applied' });
      expect(overtaken).toEqual<CommitChangesResult>({
        status: 'empty',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: titleOfP1,
      });
    });

    it('with overlapping selections and expected: the overtaken commit is stale and writes nothing', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: titlesOfP1AndP2,
      });

      const { overtaken } = await commitOvertakenBy(
        kit,
        draft,
        { selection: titlesOfP1AndP2, expected: preview.fingerprint },
        () => draft.commitChanges({ selection: titleOfP1 }),
      );

      expect(overtaken).toEqual<CommitChangesResult>({
        status: 'stale',
        changed: ['revisions', 'units'],
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: titleOfP1,
      });
      await expectData(draft, 'head', PRODUCTS, 'p2', {
        title: 'two',
        price: 2,
      });
    });
  });

  describe('a partial commit and a partial revert', () => {
    it('of different rows both apply: the commit re-plans on the reverted Draft', async () => {
      const draft = await givenEditedPrices();

      const { overtaken, overtaking } = await commitOvertakenBy(
        kit,
        draft,
        { selection: titleOfP1 },
        () => draft.revertChanges({ selection: titleOfP2 }),
      );

      expect(overtaking).toMatchObject({ status: 'applied' });
      expect(overtaken).toMatchObject({ status: 'applied' });
      await expectData(draft, 'head', PRODUCTS, 'p1', {
        title: 'uno',
        price: 1,
      });
      await expectData(draft, 'draft', PRODUCTS, 'p2', {
        title: 'two',
        price: 2,
      });
    });
  });

  function expectCommitted(
    result: CommitChangesResult,
  ): asserts result is CommittedDraft {
    expect(result).toMatchObject({ status: 'applied' });
  }

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
    expect(await dataOf(draft, side, tableId, rowId)).toEqual(data);
  }

  async function dataOf(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
    rowId: string,
  ): Promise<JsonValue> {
    const row = await draft.row(side, tableId, rowId);

    return row.data;
  }

  async function givenEditedPrices(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
    });
    await editPrices(draft);

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

  async function editPrices(draft: ChangesScenario): Promise<void> {
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });
    await draft.updateRow(PRODUCTS, 'p2', { title: 'dos', price: 2 });
  }
});
