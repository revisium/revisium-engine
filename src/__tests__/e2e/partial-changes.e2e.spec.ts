import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import { namesExportedFrom } from 'src/__tests__/utils/package-exports';
import * as engine from 'src/index';
import {
  ChangeType,
  RowChangeDetailType,
  type ChangesBranch,
  type EngineApiService,
  type InputJsonValue,
  type ListedUnit,
  type Selection,
} from 'src/index';
import {
  createEngineE2eTestKit,
  type EngineE2eTestKit,
} from './engine-api.e2e-helper';

const PACKAGE_ENTRY = join(__dirname, '..', '..', 'index.ts');
const PARTIAL_CHANGES_MODULES = './features/partial-changes/';
const NATIVE_DIFF_TYPES_MODULE = './features/revision-changes/types';

const CHANGES_API_TYPES = [
  'AnnotationKeyword',
  'ApplyStatus',
  'BlockerCode',
  'CauseRole',
  'ChangeOperation',
  'ChangedField',
  'ChangedSharedSchema',
  'ChangesBlocked',
  'ChangesBranch',
  'ChangesRequireAdditions',
  'ChangesStale',
  'CommitChangesInput',
  'CommitChangesResult',
  'CommittedDraft',
  'ComputedSelection',
  'ContentEqualSelection',
  'DeferredPath',
  'DeferredRow',
  'DeferredValue',
  'DescribedUnitRef',
  'DraftChangesSummary',
  'DraftChangesSummaryInput',
  'DraftColumnChange',
  'DraftFieldChange',
  'DraftFieldChangeType',
  'DraftPageInfo',
  'DraftReadState',
  'DraftRowChangesFilters',
  'DraftRowChangesInput',
  'DraftRowItem',
  'DraftRowPage',
  'DraftTableChangesFilters',
  'DraftTableChangesInput',
  'DraftTableItem',
  'DraftTablePage',
  'FieldRef',
  'FieldSelection',
  'FieldSelectionState',
  'FieldUnitSelection',
  'FollowReason',
  'FollowedUnit',
  'GoesWithReason',
  'GoesWithSelection',
  'IdExchange',
  'IdExchangeTermination',
  'IdTakeover',
  'ListChangesInput',
  'ListChangesResult',
  'ListedUnit',
  'MigrationRenumbering',
  'NothingToApply',
  'PlanBlocker',
  'PlanCounts',
  'PlanEstimate',
  'PlannedPreview',
  'PreviewBase',
  'PreviewChangesInput',
  'PreviewChangesResult',
  'PreviewStatus',
  'ReasonCause',
  'ReasonSite',
  'ReasonSiteKind',
  'ReferencedEntity',
  'RefusalCode',
  'RefusedSelection',
  'RefusedTable',
  'RequiredReason',
  'RequiredReasonCode',
  'RequiredUnit',
  'RevertChangesInput',
  'RevertChangesResult',
  'RevertedDraft',
  'RowColumn',
  'RowRef',
  'RowSelection',
  'RowSelectionState',
  'SelectableTableSelection',
  'Selection',
  'SelectionInput',
  'SelectionItems',
  'SelectorSide',
  'StaleChange',
  'StoppedPreview',
  'StructureChange',
  'StructureFieldChange',
  'StructureTableChange',
  'TableCoverage',
  'TableRef',
  'TableSelection',
  'TableSelectionState',
  'TransientTable',
  'UnappliedChanges',
  'Unit',
  'UnitKind',
  'UnitRef',
  'UnmatchedSelectors',
  'ViewsOnlyTable',
];

// The values of each code union of partial-changes-v1 §5.11 and draft-reads-v1 §9.
const CODE_LISTS: Readonly<Record<string, readonly string[]>> = {
  ANNOTATION_KEYWORDS: [
    'contentMediaType',
    'default',
    'deprecated',
    'description',
    'readOnly',
    'title',
  ],
  APPLY_STATUSES: ['applied', 'blocked', 'empty', 'required', 'stale'],
  BLOCKER_CODES: [
    'danglingInSource',
    'headSchemaInconsistent',
    'invalidRow',
    'invalidViews',
    'ledgerInconsistent',
    'migrationInProgress',
    'notSelectable',
    'requiredExcluded',
    'tooLarge',
    'unledgeredTable',
    'unmatchedSelector',
    'unrecordedStructureChange',
  ],
  CAUSE_ROLES: ['occupant', 'referrer', 'remover', 'taker'],
  CHANGE_OPERATIONS: ['commit', 'revert'],
  FIELD_SELECTION_STATES: ['computed', 'goesWith', 'refused', 'unit'],
  FOLLOW_REASONS: ['referenceRename'],
  GOES_WITH_REASONS: ['rowExistence', 'structureBound', 'tableExistence'],
  ID_EXCHANGE_TERMINATIONS: ['cycle', 'deletedOccupant', 'freeId', 'truncated'],
  PREVIEW_STATUSES: ['blocked', 'empty', 'ready', 'required'],
  REASON_SITE_KINDS: [
    'migration',
    'row',
    'rowId',
    'schema',
    'selector',
    'tableId',
  ],
  REFUSAL_CODES: ['headSchemaInconsistent', 'unledgeredTable'],
  REQUIRED_REASON_CODES: [
    'atomicValue',
    'idOccupied',
    'referencedRowMissing',
    'referencedTableMissing',
    'referrerStillReferences',
    'structureBoundData',
    'wholeRowUnit',
  ],
  ROW_COLUMNS: ['meta', 'publishedAt', 'schemaHash'],
  ROW_SELECTION_STATES: ['computed', 'goesWith', 'refused', 'selectable'],
  SELECTOR_SIDES: ['head'],
  STALE_CHANGES: ['content', 'operation', 'revisions', 'units', 'version'],
  STRUCTURE_FIELD_CHANGES: [
    'added',
    'annotated',
    'changed',
    'moved',
    'removed',
  ],
  STRUCTURE_TABLE_CHANGES: [
    'changed',
    'created',
    'removed',
    'replaced',
    'transient',
  ],
  TABLE_SELECTION_STATES: ['contentEqual', 'refused', 'selectable'],
  UNIT_KINDS: [
    'field',
    'rowColumns',
    'rowCreate',
    'rowDelete',
    'rowRename',
    'rowReplace',
    'sharedSchema',
    'structure',
    'views',
  ],
};

// Draft read items carry these native diff types (draft-reads-v1 §9).
const NATIVE_DIFF_NAMES = {
  types: [
    'RevisionChangeSummary',
    'SchemaMigrationDetail',
    'ViewsChangeDetail',
  ],
  values: ['ChangeType', 'RowChangeDetailType'],
};

const CLASHING_NAMES = [
  'Blocker',
  'Counts',
  'Deferred',
  'Estimate',
  'FieldChange',
  'Reason',
  'TableChange',
];

const CHANGES_OPERATIONS = [
  'commit',
  'list',
  'preview',
  'revert',
  'rowChanges',
  'summary',
  'tableChanges',
];

const PRODUCTS = 'products';

const productSchema = obj({ title: str(), price: num() });

const lampTitle = { tableId: PRODUCTS, rowId: 'lamp', path: '/title' };
const deskPrice = { tableId: PRODUCTS, rowId: 'desk', path: '/price' };

const lampTitleSelection: Selection = { fields: [lampTitle] };
const deskPriceSelection: Selection = { fields: [deskPrice] };

const lampTitleUnit: ListedUnit = {
  kind: 'field',
  ...lampTitle,
  selector: lampTitleSelection,
};
const deskPriceUnit: ListedUnit = {
  kind: 'field',
  ...deskPrice,
  selector: deskPriceSelection,
};

describe('package exports of the changes API (AS-81)', () => {
  it('exports the types and code lists of the changes API under their SPEC names', () => {
    expect(namesExportedFrom(PACKAGE_ENTRY, PARTIAL_CHANGES_MODULES)).toEqual({
      types: CHANGES_API_TYPES,
      values: Object.keys(CODE_LISTS),
    });
  });

  it('exports the native diff types that Draft read items carry', () => {
    expect(namesExportedFrom(PACKAGE_ENTRY, NATIVE_DIFF_TYPES_MODULE)).toEqual(
      NATIVE_DIFF_NAMES,
    );
  });

  it('exports no name that clashes with a native diff payload or reads as a generic noun', () => {
    const { types, values } = namesExportedFrom(PACKAGE_ENTRY, './');

    expect(
      [...types, ...values].filter((name) => CLASHING_NAMES.includes(name)),
    ).toEqual([]);
  });

  it.each(Object.entries(CODE_LISTS))(
    '%s holds exactly the values of its code union',
    (name, values) => {
      const exported: Readonly<Record<string, unknown>> = engine;

      expect(exported[name]).toEqual(expect.arrayContaining(values));
      expect(exported[name]).toHaveLength(values.length);
    },
  );
});

describe('EngineApiService.changes (AS-92)', () => {
  let kit: EngineE2eTestKit;
  let changes: EngineApiService['changes'];
  let startRevisionId: string;
  let branchCount = 0;
  let branchId: string;
  let branch: ChangesBranch;
  let draftRevisionId: string;

  beforeAll(async () => {
    kit = await createEngineE2eTestKit();
    changes = kit.api.changes;
    startRevisionId = (await kit.api.getHeadRevision(kit.branchId)).id;
  });

  beforeEach(async () => {
    branchCount += 1;
    branch = { projectId: kit.projectId, branchName: `changes-${branchCount}` };
    branchId = (
      await kit.api.createBranch({
        revisionId: startRevisionId,
        branchName: branch.branchName,
      })
    ).id;
    draftRevisionId = (await kit.api.getDraftRevision(branchId)).id;
  });

  afterAll(async () => {
    await kit.close();
  });

  it('exposes the seven operations in the changes namespace', () => {
    expect(Object.keys(changes).sort()).toEqual(CHANGES_OPERATIONS);
  });

  it('reads the Draft, reverts one change after its preview and commits the other', async () => {
    await givenCommittedProducts({
      lamp: { title: 'Lamp', price: 10 },
      desk: { title: 'Desk', price: 20 },
    });
    await updateDraftProduct('lamp', { title: 'Desk lamp', price: 10 });
    await updateDraftProduct('desk', { title: 'Desk', price: 25 });

    expect(await changes.summary({ branch })).toMatchObject({
      rowsSummary: { total: 2, modified: 2 },
      rowsWithUnits: 2,
      refusedTables: [],
    });
    expect(await changes.tableChanges({ branch, first: 10 })).toMatchObject({
      edges: [
        {
          node: {
            tableId: PRODUCTS,
            changeType: ChangeType.Modified,
            selection: {
              state: 'selectable',
              tableData: { selector: { tableData: [PRODUCTS] }, rows: 2 },
            },
          },
        },
      ],
      totalCount: 1,
    });
    expect(
      await changes.rowChanges({
        branch,
        first: 10,
        filters: { tableId: PRODUCTS },
      }),
    ).toMatchObject({
      edges: [
        {
          node: {
            rowId: 'desk',
            fields: [
              {
                path: '/price',
                changeType: RowChangeDetailType.FieldModified,
                oldValue: 20,
                newValue: 25,
                selection: { state: 'unit', unit: deskPriceUnit },
              },
            ],
          },
        },
        {
          node: {
            rowId: 'lamp',
            fields: [
              {
                path: '/title',
                selection: { state: 'unit', unit: lampTitleUnit },
              },
            ],
          },
        },
      ],
      pageInfo: { hasNextPage: false },
    });
    expect(await changes.list({ branch })).toMatchObject({
      units: [deskPriceUnit, lampTitleUnit],
      nextCursor: null,
      refusedTables: [],
    });

    const preview = await changes.preview({
      branch,
      operation: 'revert',
      selection: deskPriceSelection,
    });

    expect(preview).toMatchObject({
      status: 'ready',
      planned: true,
      counts: { selected: 1, required: 0 },
    });
    expect(
      await changes.revert({
        branch,
        selection: deskPriceSelection,
        expected: preview.fingerprint,
      }),
    ).toMatchObject({
      status: 'applied',
      applied: { selected: 1, required: 0 },
      draftHasChanges: true,
    });
    expect(
      await changes.commit({
        branch,
        selection: lampTitleSelection,
        comment: 'Rename the lamp',
      }),
    ).toMatchObject({
      status: 'applied',
      applied: { selected: 1, required: 0 },
      draftHasChanges: false,
      renumberedMigrations: [],
    });

    expect(await headProductData('lamp')).toEqual({
      title: 'Desk lamp',
      price: 10,
    });
    expect(await headProductData('desk')).toEqual({ title: 'Desk', price: 20 });
    expect((await changes.list({ branch })).units).toEqual([]);
  });

  it('says what changed when the Draft changed after the preview', async () => {
    await givenCommittedProducts({ lamp: { title: 'Lamp', price: 10 } });
    await updateDraftProduct('lamp', { title: 'Desk lamp', price: 10 });

    const preview = await changes.preview({
      branch,
      operation: 'commit',
      selection: lampTitleSelection,
    });

    await updateDraftProduct('lamp', { title: 'Floor lamp', price: 10 });

    expect(
      await changes.commit({
        branch,
        selection: lampTitleSelection,
        expected: preview.fingerprint,
      }),
    ).toEqual({
      status: 'stale',
      changed: ['content'],
      headRevisionId: preview.headRevisionId,
      draftRevisionId: preview.draftRevisionId,
      unmatched: {},
    });
  });

  it('treats null optional inputs as absent in every operation', async () => {
    await givenCommittedProducts({ lamp: { title: 'Lamp', price: 10 } });
    await updateDraftProduct('lamp', { title: 'Desk lamp', price: 10 });

    expect(
      await changes.list({
        branch,
        tableId: null,
        cursor: null,
        pageSize: null,
      }),
    ).toEqual(await changes.list({ branch }));
    expect(
      await changes.tableChanges({
        branch,
        first: 10,
        after: null,
        filters: { changeTypes: null, search: null },
      }),
    ).toEqual(await changes.tableChanges({ branch, first: 10 }));
    expect(
      await changes.rowChanges({
        branch,
        first: 10,
        after: null,
        filters: null,
      }),
    ).toEqual(await changes.rowChanges({ branch, first: 10 }));
    expect(await changes.summary({ branch, filters: null })).toEqual(
      await changes.summary({ branch }),
    );
    expect(
      await changes.preview({
        branch,
        operation: 'commit',
        selection: { ...lampTitleSelection, all: null, exclude: null },
        includeRequired: null,
      }),
    ).toEqual(
      await changes.preview({
        branch,
        operation: 'commit',
        selection: lampTitleSelection,
      }),
    );
    expect(
      await changes.revert({
        branch,
        selection: { ...lampTitleSelection, rows: null },
        includeRequired: null,
        expected: null,
      }),
    ).toMatchObject({ status: 'applied' });

    await updateDraftProduct('lamp', { title: 'Desk lamp', price: 10 });

    expect(
      await changes.commit({
        branch,
        selection: lampTitleSelection,
        includeRequired: null,
        expected: null,
        comment: null,
      }),
    ).toMatchObject({ status: 'applied' });
  });

  it.each<[string, () => Promise<unknown>, string]>([
    [
      'list',
      () => changes.list({ branch, pageSize: 0 }),
      'pageSize must be an integer',
    ],
    [
      'preview',
      () =>
        changes.preview({
          branch,
          operation: 'commit',
          selection: malformed({ tables: [PRODUCTS] }),
        }),
      'selection.tables is not allowed',
    ],
    [
      'commit',
      () =>
        changes.commit({
          branch,
          selection: lampTitleSelection,
          expected: 'abc',
        }),
      'expected must be a fingerprint',
    ],
    [
      'revert',
      () =>
        changes.revert({
          branch,
          selection: lampTitleSelection,
          includeRequired: malformed('yes'),
        }),
      'includeRequired must be a boolean',
    ],
    [
      'tableChanges',
      () => changes.tableChanges({ branch, first: 0 }),
      'first must be an integer',
    ],
    [
      'rowChanges',
      () =>
        changes.rowChanges({
          branch,
          first: 10,
          filters: { tableId: malformed(5) },
        }),
      'filters.tableId must be a string',
    ],
    [
      'summary',
      () => changes.summary({ branch, filters: { search: 'a\u0000' } }),
      'filters.search must not contain the NUL character',
    ],
  ])(
    'refuses malformed input of %s as a bad request',
    async (_operation, call, message) => {
      const refusal = call();

      await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
      await expect(refusal).rejects.toThrow(message);
    },
  );

  async function givenCommittedProducts(
    rows: Readonly<Record<string, InputJsonValue>>,
  ): Promise<void> {
    await kit.api.createTable({
      revisionId: draftRevisionId,
      tableId: PRODUCTS,
      schema: productSchema,
    });

    for (const [rowId, data] of Object.entries(rows)) {
      await kit.api.createRow({
        revisionId: draftRevisionId,
        tableId: PRODUCTS,
        rowId,
        data,
      });
    }

    await kit.api.createRevision(branch);
    draftRevisionId = (await kit.api.getDraftRevision(branchId)).id;
  }

  async function updateDraftProduct(
    rowId: string,
    data: InputJsonValue,
  ): Promise<void> {
    await kit.api.updateRow({
      revisionId: draftRevisionId,
      tableId: PRODUCTS,
      rowId,
      data,
    });
  }

  async function headProductData(rowId: string): Promise<unknown> {
    const head = await kit.api.getHeadRevision(branchId);
    const row = await kit.api.getRow({
      revisionId: head.id,
      tableId: PRODUCTS,
      rowId,
    });

    return row?.data;
  }
});

function malformed<T>(value: unknown): T {
  return value as T;
}
