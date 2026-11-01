import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  type PlanVariant,
  readPlanFingerprint,
} from '../../__tests__/support/plan-fingerprinting';
import {
  READING_EVERY_TABLE,
  readScopedCatalogue,
} from '../../__tests__/support/scoped-reading';

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const RELEASE_DATE = '2030-01-01T00:00:00.000Z';
const SHA_256_HEX = /^[0-9a-f]{64}$/;

const productSchema = obj({ title: str(), price: num() });
const categorySchema = obj({ title: str() });

const priceOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/price' };
const priceSelection = { fields: [priceOfP1] };
const productsStructure = { tables: [PRODUCTS] };

interface EditCase {
  readonly edit: string;
  readonly apply: (draft: ChangesScenario) => Promise<void>;
}

describe('PlanFingerprint', () => {
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

  it('is the same SHA-256 for the same state', async () => {
    const draft = await givenPriceEdit();

    const first = await draft.fingerprintPlan('commit', priceSelection);
    const second = await draft.fingerprintPlan('commit', priceSelection);

    expect(first).toMatch(SHA_256_HEX);
    expect(second).toBe(first);
  });

  it('differs between a commit and a revert of the same selection', async () => {
    const draft = await givenPriceEdit();

    const commit = await draft.fingerprintPlan('commit', priceSelection);
    const revert = await draft.fingerprintPlan('revert', priceSelection);

    expect(revert).not.toBe(commit);
  });

  it.each<{ revision: string; variant: PlanVariant }>([
    { revision: 'Head', variant: withRevisionIds({ headRevisionId: 'other' }) },
    {
      revision: 'Draft',
      variant: withRevisionIds({ draftRevisionId: 'other' }),
    },
  ])('changes with the $revision revision id', async ({ variant }) => {
    const draft = await givenPriceEdit();

    const planned = await draft.fingerprintPlan('commit', priceSelection);
    const varied = await draft.fingerprintPlan(
      'commit',
      priceSelection,
      variant,
    );

    expect(varied).not.toBe(planned);
  });

  it.each<EditCase>([
    {
      edit: 'another field of the row',
      apply: (draft) =>
        draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 2 }),
    },
    {
      edit: 'its meta, keeping its hash',
      apply: (draft) =>
        draft.writeRowColumns(PRODUCTS, 'p1', { meta: { note: 'checked' } }),
    },
    {
      edit: 'its publishedAt, keeping its hash',
      apply: (draft) =>
        draft.writeRowColumns(PRODUCTS, 'p1', { publishedAt: RELEASE_DATE }),
    },
  ])('changes when a covered row changes: $edit', async ({ apply }) => {
    const draft = await givenPriceEdit();
    const before = await draft.fingerprintPlan('commit', priceSelection);

    await apply(draft);

    expect(await draft.fingerprintPlan('commit', priceSelection)).not.toBe(
      before,
    );
  });

  it('changes when a system row owned by a selected unit changes', async () => {
    const draft = await givenViewsEdit();
    const before = await draft.fingerprintPlan('commit', { views: [PRODUCTS] });

    await draft.updateViews(PRODUCTS, productViews('Edited again'));

    expect(
      await draft.fingerprintPlan('commit', { views: [PRODUCTS] }),
    ).not.toBe(before);
  });

  it.each<EditCase>([
    {
      edit: 'a value of the field its structure added',
      apply: (draft) =>
        draft.updateRow(PRODUCTS, 'p2', {
          title: 'p2',
          price: 1,
          color: 'red',
        }),
    },
    {
      edit: 'the meta of a row, keeping its hash',
      apply: (draft) =>
        draft.writeRowColumns(PRODUCTS, 'p2', { meta: { note: 'checked' } }),
    },
  ])(
    'changes when any row of the mutable Draft table version of a selected structure unit changes: $edit',
    async ({ apply }) => {
      const draft = await givenAddedColor();
      const before = await draft.fingerprintPlan('revert', productsStructure);

      await apply(draft);

      expect(await draft.fingerprintPlan('revert', productsStructure)).not.toBe(
        before,
      );
    },
  );

  it.each<EditCase>([
    {
      edit: 'another row of the table',
      apply: (draft) =>
        draft.updateRow(PRODUCTS, 'p2', { title: 'dos', price: 2 }),
    },
    {
      edit: 'another table',
      apply: (draft) =>
        draft.updateRow(CATEGORIES, 'c1', { title: 'renamed again' }),
    },
  ])(
    'does not change when an unselected row changes: $edit',
    async ({ apply }) => {
      const draft = await givenPriceEdit();
      const before = await draft.fingerprintPlan('commit', priceSelection);

      await apply(draft);

      expect(await draft.fingerprintPlan('commit', priceSelection)).toBe(
        before,
      );
    },
  );

  it('reads a number of statements that does not grow with the covered rows', async () => {
    const reads = await statementsOfFingerprintCovering(12);

    expect(reads).toBeGreaterThan(0);
    expect(reads).toBe(await statementsOfFingerprintCovering(1));
  });

  describe('a read scope that reads every table (AS-74)', () => {
    let wideKit: PartialChangesTestKit;

    beforeAll(async () => {
      wideKit = await createPartialChangesTestKit({
        overrides: [READING_EVERY_TABLE],
      });
    });

    afterAll(async () => {
      await wideKit.close();
    });

    it('gives the fingerprint of the scoped read', async () => {
      const draft = await givenPriceEdit();
      expect(
        await readScopedCatalogue(wideKit, draft.branch, priceSelection),
      ).toMatchObject({ readTableIds: [CATEGORIES, PRODUCTS] });

      const scoped = await draft.fingerprintPlan('commit', priceSelection);
      const wide = await readPlanFingerprint(
        wideKit,
        draft.branch,
        'commit',
        priceSelection,
      );

      expect(wide).toBe(scoped);
    });
  });

  async function statementsOfFingerprintCovering(
    rowCount: number,
  ): Promise<number> {
    const draft = await givenAddedColor();
    await editPrices(draft, rowCount);
    const textReads = jest.spyOn(kit.snapshotReader, 'readRowVersionTexts');
    const digestReads = jest.spyOn(kit.snapshotReader, 'readRowDigest');

    await draft.fingerprintPlan('revert', {
      tables: [PRODUCTS],
      tableData: [PRODUCTS],
    });
    const statements =
      textReads.mock.calls.length + digestReads.mock.calls.length;
    jest.restoreAllMocks();

    return statements;
  }

  async function givenPriceEdit(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'first' } },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', price: 10 });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'renamed' });

    return draft;
  }

  async function givenViewsEdit(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
    });
    await draft.updateViews(PRODUCTS, productViews('All'));
    await draft.commit();
    await draft.updateViews(PRODUCTS, productViews('Edited'));

    return draft;
  }

  async function givenAddedColor(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: Object.fromEntries(
          rowIdsOf(12).map((rowId) => [rowId, { title: rowId, price: 1 }]),
        ),
      },
    });
    await draft.updateTable(PRODUCTS, [addField('color', str())]);

    return draft;
  }
});

async function editPrices(
  draft: ChangesScenario,
  rowCount: number,
): Promise<void> {
  for (const rowId of rowIdsOf(rowCount)) {
    await draft.updateRow(PRODUCTS, rowId, {
      title: rowId,
      price: 2,
      color: '',
    });
  }
}

function rowIdsOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `p${index + 1}`);
}

function withRevisionIds(
  revisions: Partial<{ headRevisionId: string; draftRevisionId: string }>,
): PlanVariant {
  return (plan) => ({ ...plan, snapshot: { ...plan.snapshot, ...revisions } });
}

function productViews(name: string): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name,
        columns: [{ field: 'data.title' }, { field: 'data.price' }],
      },
    ],
  };
}
