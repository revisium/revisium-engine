import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { branchContentsOf } from 'src/__tests__/fixtures/branch-content';
import type { ChangesStale } from 'src/features/partial-changes/commands/impl/apply-changes';
import type { PlanPlace } from 'src/features/partial-changes/planning/plan-places';
import type { PreviewChangesResult } from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import type { CommitOptions } from '../../__tests__/support/change-committing';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
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
const EARLIER = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

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

  it.each(OPERATIONS)(
    'a %s names the places it applies now, most recently changed first, so the one edited after the preview is told apart (AS-103)',
    async (operation) => {
      const draft = await givenEditedCatalog();
      await draft.stampDraftRowChanges(PRODUCTS, { p1: EARLIER, p2: LATER });
      const preview = await draft.previewChanges({
        operation,
        selection: titlesOfP1AndP2,
      });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'one!', category: 'c1' });

      const result = await apply(draft, operation, {
        selection: titlesOfP1AndP2,
        expected: fingerprintOfPreview(preview),
      });

      expect(result).toMatchObject({
        status: 'stale',
        changed: ['content'],
        places: [
          { kind: 'row', tableId: PRODUCTS, rowId: 'p1', units: ['field'] },
          {
            kind: 'row',
            tableId: PRODUCTS,
            rowId: 'p2',
            units: ['field'],
            changedAt: new Date(LATER),
          },
        ],
        placesTotal: 2,
      });
      expect(editedAfter(result, preview.plannedAt)).toEqual(['products/p1']);
    },
  );

  it('names a structure by its table, a deleted row last without a time, and the units of each place (AS-103)', async () => {
    const draft = await givenEditedCatalog();
    await draft.removeRow(PRODUCTS, 'p2');
    await draft.renameRow(PRODUCTS, 'p1', 'p1x');
    await draft.updateTable(CATEGORIES, [addField('color', str())]);
    const selection: Selection = {
      rows: [
        { tableId: PRODUCTS, rowId: 'p1x' },
        { tableId: PRODUCTS, rowId: 'p2' },
      ],
      structures: [{ tableId: CATEGORIES }],
    };
    const preview = await draft.previewChanges({
      operation: 'commit',
      selection,
    });
    await draft.updateRow(PRODUCTS, 'p1x', { title: 'one!', category: 'c1' });

    const result = await apply(draft, 'commit', {
      selection,
      expected: fingerprintOfPreview(preview),
    });

    expect(result).toMatchObject({
      status: 'stale',
      places: [
        {
          kind: 'row',
          tableId: PRODUCTS,
          rowId: 'p1x',
          units: ['field', 'rowRename'],
        },
        {
          kind: 'table',
          tableId: CATEGORIES,
          units: ['structure'],
          changedAt: expect.any(Date) as Date,
        },
        {
          kind: 'row',
          tableId: PRODUCTS,
          rowId: 'p2',
          units: ['rowDelete'],
          changedAt: null,
        },
      ],
      placesTotal: 3,
    });
    expect(editedAfter(result, preview.plannedAt)).toEqual(['products/p1x']);
  });

  async function apply(
    draft: ChangesScenario,
    operation: ChangeOperation,
    options: CommitOptions,
  ) {
    return operation === 'commit'
      ? draft.commitChanges(options)
      : draft.revertChanges(options);
  }

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
      places: expect.any(Array) as PlanPlace[],
      placesTotal: expect.any(Number) as number,
    });
    expect(await branchContentsOf(kit, draft)).toEqual(contents);
  }

  function fingerprintOfPreview(preview: PreviewChangesResult): string {
    if (!preview.planned) {
      throw new Error('A limit stopped the preview');
    }

    return preview.fingerprint;
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

// The places of a stale result whose last change is later than the preview, as a client tells them.
function editedAfter(
  result: CommitChangesResult | RevertChangesResult,
  plannedAt: Date,
): string[] {
  if (result.status !== 'stale') {
    return [];
  }

  return result.places.flatMap((place) =>
    place.kind === 'row' &&
    place.changedAt !== null &&
    place.changedAt > plannedAt
      ? [`${place.tableId}/${place.rowId}`]
      : [],
  );
}
