import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { branchContentsOf } from 'src/__tests__/fixtures/branch-content';
import type { ChangesStale } from 'src/features/partial-changes/commands/impl/apply-changes';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import type { CommitOptions } from '../../__tests__/support/change-committing';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const fieldOf = (rowId: string, path: string): FieldRef => ({
  tableId: PRODUCTS,
  rowId,
  path,
});

const titleOfP1: Selection = { fields: [fieldOf('p1', '/title')] };
const titlesOfP1AndP2: Selection = {
  fields: [fieldOf('p1', '/title'), fieldOf('p2', '/title')],
};
const categoryOfP1: Selection = { fields: [fieldOf('p1', '/category')] };
const rowP1: Selection = { rows: [{ tableId: PRODUCTS, rowId: 'p1' }] };
const titleOfC1: Selection = {
  fields: [{ tableId: CATEGORIES, rowId: 'c1', path: '/title' }],
};

const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];

describe('a stale commit or revert says what changed (SPEC §9.2, AS-90)', () => {
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

  it.each(OPERATIONS)(
    'a %s previewed before a partial commit of another table: the revisions only',
    async (operation) => {
      const draft = await givenEditedCatalog();
      const expected = await fingerprintOf(draft, operation, titleOfP1);
      await draft.commitChanges({ selection: titleOfC1 });

      await expectStale(draft, operation, { selection: titleOfP1, expected }, [
        'revisions',
      ]);
    },
  );

  it('a commit previewed before a new required addition: the units', async () => {
    const draft = await givenEditedCatalog();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c2' });
    const expected = await fingerprintOf(draft, 'commit', categoryOfP1);
    await draft.createRows(CATEGORIES, { c9: { title: 'nine' } });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c9' });

    await expectStale(
      draft,
      'commit',
      { selection: categoryOfP1, includeRequired: true, expected },
      ['units'],
    );
  });

  it.each(OPERATIONS)(
    'a %s of a row previewed before an edit of another of its fields, which adds a unit: the units',
    async (operation) => {
      const draft = await givenEditedCatalog();
      const expected = await fingerprintOf(draft, operation, rowP1);
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c2' });

      await expectStale(draft, operation, { selection: rowP1, expected }, [
        'units',
      ]);
    },
  );

  it.each(OPERATIONS)(
    'a %s whose kept selector no longer matches: the units, and the unmatched selector',
    async (operation) => {
      const draft = await givenEditedCatalog();
      const expected = await fingerprintOf(draft, operation, titlesOfP1AndP2);
      await draft.updateRow(PRODUCTS, 'p2', { title: 'two', category: 'c1' });

      await expectStale(
        draft,
        operation,
        { selection: titlesOfP1AndP2, expected },
        ['units'],
        { fields: [fieldOf('p2', '/title')] },
      );
    },
  );

  it.each(OPERATIONS)(
    'a %s with a well-formed fingerprint of other rules: the version only',
    async (operation) => {
      const draft = await givenEditedCatalog();
      const previewed = await fingerprintOf(draft, operation, titleOfP1);

      await expectStale(
        draft,
        operation,
        { selection: titleOfP1, expected: previewed.replace('pcf2.', 'pcf3.') },
        ['version'],
      );
      await expectStale(
        draft,
        operation,
        { selection: titleOfP1, expected: 'pcf3.AA' },
        ['version'],
      );
    },
  );

  async function expectStale(
    draft: ChangesScenario,
    operation: ChangeOperation,
    options: CommitOptions,
    changed: ChangesStale['changed'],
    unmatched: ChangesStale['unmatched'] = {},
  ): Promise<void> {
    const contents = await branchContentsOf(kit, draft);

    const result =
      operation === 'commit'
        ? await draft.commitChanges(options)
        : await draft.revertChanges(options);

    expect(result).toEqual<ChangesStale>({
      status: 'stale',
      changed,
      headRevisionId: await draft.revisionId('head'),
      draftRevisionId: await draft.revisionId('draft'),
      unmatched,
    });
    expect(await branchContentsOf(kit, draft)).toEqual(contents);
  }

  async function fingerprintOf(
    draft: ChangesScenario,
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<string> {
    const preview = await draft.previewChanges({ operation, selection });

    if (!preview.planned) {
      throw new Error('A limit stopped the preview');
    }

    return preview.fingerprint;
  }

  async function givenEditedCatalog(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'one' }, c2: { title: 'two' } },
      },
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', category: 'c1' },
          p2: { title: 'two', category: 'c1' },
        },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c1' });
    await draft.updateRow(PRODUCTS, 'p2', { title: 'dos', category: 'c1' });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'first' });

    return draft;
  }
});
