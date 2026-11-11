import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import {
  type Fingerprint,
  staleChangesOf,
} from 'src/features/partial-changes/plan/fingerprint';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  type PlanVariant,
  readPlanFingerprint,
} from '../../__tests__/support/plan-fingerprinting';
import {
  READING_EVERY_TABLE,
  readScopedCatalogue,
} from '../../__tests__/support/scoped-reading';
import { tableViews } from '../../__tests__/support/views-documents';

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const GOODS = 'goods';
const RELEASE_DATE = '2030-01-01T00:00:00.000Z';
const STALE_SCHEMA_HASH = 'stale-schema-hash';
const SHA_256_HEX = /^[0-9a-f]{64}$/;

const productSchema = obj({ title: str(), price: num() });
const categorySchema = obj({ title: str() });

const priceOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/price' };
const priceSelection = { fields: [priceOfP1] };
const productsStructure = { structures: [{ tableId: PRODUCTS }] };
const productRow = (rowId: string): RowRef => ({ tableId: PRODUCTS, rowId });
const rowP1 = { rows: [productRow('p1')] };

interface EditCase {
  readonly edit: string;
  readonly apply: (draft: ChangesScenario) => Promise<void>;
}

interface StructureOwnershipCase {
  readonly unit: UnitKind;
  readonly operation: ChangeOperation;
  readonly selection: Selection;
  readonly given: () => Promise<ChangesScenario>;
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

  it('is the same for the same state: the operation, the revision ids and SHA-256 digests of the units and their content', async () => {
    const draft = await givenPriceEdit();

    const first = await draft.fingerprintPlan('commit', priceSelection);
    const second = await draft.fingerprintPlan('commit', priceSelection);

    expect(first).toEqual<Fingerprint>({
      operation: 'commit',
      headRevisionId: await draft.revisionId('head'),
      draftRevisionId: await draft.revisionId('draft'),
      units: expect.stringMatching(SHA_256_HEX),
      content: expect.stringMatching(SHA_256_HEX),
    });
    expect(second).toEqual(first);
  });

  it('differs between a commit and a revert of the same selection in the operation only', async () => {
    const draft = await givenPriceEdit();

    const commit = await draft.fingerprintPlan('commit', priceSelection);
    const revert = await draft.fingerprintPlan('revert', priceSelection);

    expect(staleChangesOf(commit, revert)).toEqual(['operation']);
    expect(revert).toEqual({ ...commit, operation: 'revert' });
  });

  it('changes its units when an edit of another field of a selected row adds a unit', async () => {
    const draft = await givenPriceEdit();
    const before = await draft.fingerprintPlan('commit', rowP1);

    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });

    expect(
      staleChangesOf(before, await draft.fingerprintPlan('commit', rowP1)),
    ).toEqual(['units']);
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

    expect(staleChangesOf(planned, varied)).toEqual(['revisions']);
    expect({ ...varied, ...revisionIdsOf(planned) }).toEqual(planned);
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
  ])(
    'changes its content when a covered row changes: $edit',
    async ({ apply }) => {
      const draft = await givenPriceEdit();
      const before = await draft.fingerprintPlan('commit', priceSelection);

      await apply(draft);

      expect(
        staleChangesOf(
          before,
          await draft.fingerprintPlan('commit', priceSelection),
        ),
      ).toEqual(['content']);
    },
  );

  it('changes its content when a system row owned by a selected unit changes', async () => {
    const draft = await givenViewsEdit();
    const before = await draft.fingerprintPlan('commit', { views: [PRODUCTS] });

    await draft.updateViews(
      PRODUCTS,
      tableViews('Edited again', ['title', 'price']),
    );

    expect(
      staleChangesOf(
        before,
        await draft.fingerprintPlan('commit', { views: [PRODUCTS] }),
      ),
    ).toEqual(['content']);
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
    'changes its content when any row of the mutable Draft table version of a selected structure unit changes: $edit',
    async ({ apply }) => {
      const draft = await givenAddedColor();
      const before = await draft.fingerprintPlan('revert', productsStructure);

      await apply(draft);

      expect(
        staleChangesOf(
          before,
          await draft.fingerprintPlan('revert', productsStructure),
        ),
      ).toEqual(['content']);
    },
  );

  it.each<StructureOwnershipCase>([
    {
      unit: 'rowColumns',
      operation: 'commit',
      selection: { rowColumns: [productRow('p1')] },
      given: givenStaleSchemaHashNextToMetaEdit,
    },
    {
      unit: 'rowCreate',
      operation: 'commit',
      selection: { rows: [productRow('p3')] },
      given: givenCreatedRowWithStaleSchemaHash,
    },
    {
      unit: 'rowReplace',
      operation: 'commit',
      selection: { rows: [productRow('p1')] },
      given: givenReplacedRowWithStaleSchemaHash,
    },
    {
      unit: 'rowDelete',
      operation: 'revert',
      selection: { rows: [productRow('p1')] },
      given: givenDeletedRowWithStaleSchemaHash,
    },
  ])(
    'changes its content when a rename of the table hands the schemaHash that a selected $unit unit applies to the structure',
    async ({ operation, selection, given }) => {
      const draft = await given();
      const before = await draft.fingerprintPlan(operation, selection);

      await draft.renameTable(PRODUCTS, GOODS);

      expect(
        staleChangesOf(
          before,
          await draft.fingerprintPlan(operation, selection),
        ),
      ).toEqual(['content']);
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

      expect(await draft.fingerprintPlan('commit', priceSelection)).toEqual(
        before,
      );
    },
  );

  it('does not change for a revert of a created row when a rename of the table makes its structures differ, since the reverted row moves into no structure', async () => {
    const draft = await givenCreatedRowWithStaleSchemaHash();
    const creationOfP3 = { rows: [productRow('p3')] };
    const before = await draft.fingerprintPlan('revert', creationOfP3);

    await draft.renameTable(PRODUCTS, GOODS);

    expect(await draft.fingerprintPlan('revert', creationOfP3)).toEqual(before);
  });

  it('does not change for a selected created row of an unchanged structure when the structure of another table changes', async () => {
    const draft = await givenCreatedProductNextToCategories();
    const creationOfP3 = { rows: [productRow('p3')] };
    const before = await draft.fingerprintPlan('commit', creationOfP3);

    await draft.updateTable(CATEGORIES, [addField('color', str())]);

    expect(await draft.fingerprintPlan('commit', creationOfP3)).toEqual(before);
  });

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

      expect(wide).toEqual(scoped);
    });
  });

  describe('another engine instance (AS-91)', () => {
    let otherKit: PartialChangesTestKit;

    beforeAll(async () => {
      otherKit = await createPartialChangesTestKit();
    });

    afterAll(async () => {
      await otherKit.close();
    });

    it('gives the same fingerprint for the same plan', async () => {
      const draft = await givenPriceEdit();

      const here = await draft.fingerprintPlan('commit', priceSelection);
      const there = await readPlanFingerprint(
        otherKit,
        draft.branch,
        'commit',
        priceSelection,
      );

      expect(there).toEqual(here);
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
      structures: [{ tableId: PRODUCTS }],
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

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
    });
  }

  async function givenStaleSchemaHashNextToMetaEdit(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.writeRowColumns(PRODUCTS, 'p1', {
      meta: { note: 'checked' },
      schemaHash: STALE_SCHEMA_HASH,
    });

    return draft;
  }

  async function givenCreatedRowWithStaleSchemaHash(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.createRows(PRODUCTS, { p3: { title: 'three', price: 3 } });
    await draft.writeRowColumns(PRODUCTS, 'p3', {
      schemaHash: STALE_SCHEMA_HASH,
    });

    return draft;
  }

  async function givenReplacedRowWithStaleSchemaHash(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.removeRow(PRODUCTS, 'p1');
    await draft.createRows(PRODUCTS, { p1: { title: 'new one', price: 9 } });
    await draft.writeRowColumns(PRODUCTS, 'p1', {
      schemaHash: STALE_SCHEMA_HASH,
    });

    return draft;
  }

  async function givenDeletedRowWithStaleSchemaHash(): Promise<ChangesScenario> {
    const draft = await givenCommittedProducts();
    await draft.writeRowColumns(PRODUCTS, 'p1', {
      schemaHash: STALE_SCHEMA_HASH,
    });
    await draft.commit();
    await draft.removeRow(PRODUCTS, 'p1');

    return draft;
  }

  async function givenCreatedProductNextToCategories(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'first' } },
      },
    });
    await draft.createRows(PRODUCTS, { p3: { title: 'three', price: 3 } });

    return draft;
  }

  async function givenViewsEdit(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
    });
    await draft.updateViews(PRODUCTS, tableViews('All', ['title', 'price']));
    await draft.commit();
    await draft.updateViews(PRODUCTS, tableViews('Edited', ['title', 'price']));

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

function revisionIdsOf({
  headRevisionId,
  draftRevisionId,
}: Fingerprint): Pick<Fingerprint, 'headRevisionId' | 'draftRevisionId'> {
  return { headRevisionId, draftRevisionId };
}
