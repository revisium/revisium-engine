import { join } from 'path';
import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import { namesReExportedFrom } from 'src/__tests__/utils/package-exports';
import type {
  ChangesBranch,
  InputJsonValue,
  ListedUnit,
  Selection,
} from 'src/index';
import {
  createEngineE2eTestKit,
  type EngineE2eTestKit,
} from './engine-api.e2e-helper';

const PACKAGE_ENTRY = join(__dirname, '..', '..', 'index.ts');
const PARTIAL_CHANGES_MODULES = './features/partial-changes/';

const PUBLIC_PARTIAL_CHANGE_TYPES = [
  'Blocker',
  'BlockerCode',
  'ChangesBlocked',
  'ChangesBranch',
  'ChangesRequireAdditions',
  'ChangesStale',
  'CommitChangesInput',
  'CommitChangesResult',
  'CommittedDraft',
  'Counts',
  'Deferred',
  'Estimate',
  'HeadQualifier',
  'ListChangesInput',
  'ListChangesResult',
  'ListedUnit',
  'NothingToApply',
  'PreviewChangesInput',
  'PreviewChangesResult',
  'Reason',
  'RefusedTable',
  'RequiredReasonCode',
  'RequiredUnit',
  'RevertChangesInput',
  'RevertChangesResult',
  'RevertedDraft',
  'RowRef',
  'Selection',
  'SelectionItems',
  'Unit',
  'UnitKind',
  'UnitRef',
];

const PRODUCTS = 'products';

const productSchema = obj({ title: str(), price: num() });

const titleOfLamp = { tableId: PRODUCTS, rowId: 'lamp', path: '/title' };
const priceOfDesk = { tableId: PRODUCTS, rowId: 'desk', path: '/price' };

const lampTitleSelection: Selection = { fields: [titleOfLamp] };
const deskPriceSelection: Selection = { fields: [priceOfDesk] };

const lampTitleUnit: ListedUnit = {
  kind: 'field',
  ...titleOfLamp,
  selector: lampTitleSelection,
};
const deskPriceUnit: ListedUnit = {
  kind: 'field',
  ...priceOfDesk,
  selector: deskPriceSelection,
};

describe('EngineApiService.changes', () => {
  let kit: EngineE2eTestKit;
  let branch: ChangesBranch;

  beforeAll(async () => {
    kit = await createEngineE2eTestKit();
    branch = { projectId: kit.projectId, branchName: kit.branchName };
    await kit.revertDraftChanges();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('public surface', () => {
    it('exposes list, preview, commit and revert in the changes namespace', () => {
      expect(kit.api.changes).toEqual({
        list: expect.any(Function),
        preview: expect.any(Function),
        commit: expect.any(Function),
        revert: expect.any(Function),
      });
    });

    it('exports the public partial-change types and no values from the package entry', () => {
      expect(
        namesReExportedFrom(PACKAGE_ENTRY, PARTIAL_CHANGES_MODULES),
      ).toEqual({ types: PUBLIC_PARTIAL_CHANGE_TYPES, values: [] });
    });
  });

  it('lists the units of a small Draft, reverts one after its preview and commits the other', async () => {
    await givenCommittedProducts({
      lamp: { title: 'Lamp', price: 10 },
      desk: { title: 'Desk', price: 20 },
    });
    await updateDraftProduct('lamp', { title: 'Desk lamp', price: 10 });
    await updateDraftProduct('desk', { title: 'Desk', price: 25 });

    expect(await kit.api.changes.list({ branch })).toMatchObject({
      units: [deskPriceUnit, lampTitleUnit],
      nextCursor: null,
      refusedTables: [],
    });

    const preview = await kit.api.changes.preview({
      branch,
      operation: 'revert',
      selection: deskPriceSelection,
    });

    expect(preview.status).toBe('ready');

    expect(
      await kit.api.changes.revert({
        branch,
        selection: deskPriceSelection,
        expected: preview.fingerprint,
      }),
    ).toMatchObject({
      status: 'applied',
      applied: { selected: 1, required: 0 },
      remaining: { units: 1, unreadTables: 0 },
    });

    expect(
      await kit.api.changes.commit({
        branch,
        selection: lampTitleSelection,
        comment: 'Rename the lamp',
      }),
    ).toMatchObject({
      status: 'applied',
      applied: { selected: 1, required: 0 },
      remaining: { units: 0, unreadTables: 0 },
    });

    expect(await headProductData('lamp')).toEqual({
      title: 'Desk lamp',
      price: 10,
    });
    expect(await headProductData('desk')).toEqual({ title: 'Desk', price: 20 });
    expect((await kit.api.changes.list({ branch })).units).toEqual([]);
  });

  async function givenCommittedProducts(
    rows: Readonly<Record<string, InputJsonValue>>,
  ): Promise<void> {
    await kit.api.createTable({
      revisionId: kit.draftRevisionId,
      tableId: PRODUCTS,
      schema: productSchema,
    });

    for (const [rowId, data] of Object.entries(rows)) {
      await kit.api.createRow({
        revisionId: kit.draftRevisionId,
        tableId: PRODUCTS,
        rowId,
        data,
      });
    }

    await kit.api.createRevision(branch);
    await kit.refreshDraftRevisionId();
  }

  async function updateDraftProduct(
    rowId: string,
    data: InputJsonValue,
  ): Promise<void> {
    await kit.api.updateRow({
      revisionId: kit.draftRevisionId,
      tableId: PRODUCTS,
      rowId,
      data,
    });
  }

  async function headProductData(rowId: string): Promise<unknown> {
    const head = await kit.api.getHeadRevision(kit.branchId);
    const row = await kit.api.getRow({
      revisionId: head.id,
      tableId: PRODUCTS,
      rowId,
    });

    return row?.data;
  }
});
