import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import { namesExportedFrom } from 'src/__tests__/utils/package-exports';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
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
  'DraftEdge',
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
  'DraftTablesSummary',
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
  'MixedTableEstimate',
  'NothingToApply',
  'PlanBlocker',
  'PlanCounts',
  'PlanEstimate',
  'PlannedChangesBlocked',
  'PlannedPreview',
  'PreviewBase',
  'PreviewChangesInput',
  'PreviewChangesResult',
  'PreviewStatus',
  'ReasonCause',
  'ReasonSite',
  'ReasonSiteKind',
  'ReferencedEntity',
  'ReferencedEntityKind',
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
  'SelectableRowSelection',
  'SelectableTableSelection',
  'Selection',
  'SelectionInput',
  'SelectionItems',
  'SelectorSide',
  'StaleChange',
  'StoppedChangesBlocked',
  'StoppedPreview',
  'StructureChange',
  'StructureFieldChange',
  'StructureTableChange',
  'TableCoverage',
  'TableData',
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
  DRAFT_FIELD_CHANGE_TYPES: ['FIELD_ADDED', 'FIELD_MODIFIED', 'FIELD_REMOVED'],
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
  REFERENCED_ENTITY_KINDS: ['row', 'table'],
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

const CHANGES_FEATURE_VALUES = [
  'PartialChangesApiService',
  'PartialChangesModule',
  'isWholeDraftSelection',
];

// Draft read items carry these native diff types and the types and enums they are built of (draft-reads-v1 §9).
const NATIVE_DIFF_NAMES = {
  types: [
    'HistoryPatch',
    'JsonPatchOperation',
    'RevisionChangeSummary',
    'SchemaMigrationDetail',
    'ViewChange',
    'ViewsChangeDetail',
  ],
  values: ['ChangeType', 'JsonPatchOp', 'MigrationType', 'RowChangeDetailType'],
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

// True only when A and B are the same type; mutual assignability would also accept `any`.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type ListMember<List extends readonly unknown[]> = List[number];

// Compiles only when every check holds, so the TypeScript gate proves AS-81 for the package's own types.
function unionsEqual<_Checks extends readonly true[]>(): true {
  return true;
}

const CODE_UNIONS_EQUAL_THEIR_LISTS = {
  ANNOTATION_KEYWORDS:
    unionsEqual<
      [
        Equal<
          engine.AnnotationKeyword,
          ListMember<typeof engine.ANNOTATION_KEYWORDS>
        >,
        Equal<
          NonNullable<engine.ChangedField['annotations']>[number],
          engine.AnnotationKeyword
        >,
      ]
    >(),
  APPLY_STATUSES:
    unionsEqual<
      [
        Equal<engine.ApplyStatus, ListMember<typeof engine.APPLY_STATUSES>>,
        Equal<engine.CommitChangesResult['status'], engine.ApplyStatus>,
        Equal<engine.RevertChangesResult['status'], engine.ApplyStatus>,
      ]
    >(),
  BLOCKER_CODES:
    unionsEqual<
      [
        Equal<engine.BlockerCode, ListMember<typeof engine.BLOCKER_CODES>>,
        Equal<engine.PlanBlocker['code'], engine.BlockerCode>,
      ]
    >(),
  CAUSE_ROLES:
    unionsEqual<
      [
        Equal<engine.CauseRole, ListMember<typeof engine.CAUSE_ROLES>>,
        Equal<engine.ReasonCause['role'], engine.CauseRole>,
      ]
    >(),
  CHANGE_OPERATIONS:
    unionsEqual<
      [
        Equal<
          engine.ChangeOperation,
          ListMember<typeof engine.CHANGE_OPERATIONS>
        >,
        Equal<engine.PreviewChangesInput['operation'], engine.ChangeOperation>,
      ]
    >(),
  DRAFT_FIELD_CHANGE_TYPES:
    unionsEqual<
      [
        Equal<
          engine.DraftFieldChangeType,
          ListMember<typeof engine.DRAFT_FIELD_CHANGE_TYPES>
        >,
        Equal<
          engine.DraftFieldChange['changeType'],
          engine.DraftFieldChangeType
        >,
      ]
    >(),
  FIELD_SELECTION_STATES:
    unionsEqual<
      [
        Equal<
          engine.FieldSelectionState,
          ListMember<typeof engine.FIELD_SELECTION_STATES>
        >,
        Equal<engine.FieldSelection['state'], engine.FieldSelectionState>,
      ]
    >(),
  FOLLOW_REASONS:
    unionsEqual<
      [
        Equal<engine.FollowReason, ListMember<typeof engine.FOLLOW_REASONS>>,
        Equal<engine.FollowedUnit['reason'], engine.FollowReason>,
      ]
    >(),
  GOES_WITH_REASONS:
    unionsEqual<
      [
        Equal<
          engine.GoesWithReason,
          ListMember<typeof engine.GOES_WITH_REASONS>
        >,
        Equal<engine.GoesWithSelection['reason'], engine.GoesWithReason>,
      ]
    >(),
  ID_EXCHANGE_TERMINATIONS:
    unionsEqual<
      [
        Equal<
          engine.IdExchangeTermination,
          ListMember<typeof engine.ID_EXCHANGE_TERMINATIONS>
        >,
        Equal<engine.IdExchange['termination'], engine.IdExchangeTermination>,
      ]
    >(),
  PREVIEW_STATUSES:
    unionsEqual<
      [
        Equal<engine.PreviewStatus, ListMember<typeof engine.PREVIEW_STATUSES>>,
        Equal<engine.PreviewChangesResult['status'], engine.PreviewStatus>,
      ]
    >(),
  REASON_SITE_KINDS:
    unionsEqual<
      [
        Equal<
          engine.ReasonSiteKind,
          ListMember<typeof engine.REASON_SITE_KINDS>
        >,
        Equal<engine.ReasonSite['kind'], engine.ReasonSiteKind>,
      ]
    >(),
  REFERENCED_ENTITY_KINDS:
    unionsEqual<
      [
        Equal<
          engine.ReferencedEntityKind,
          ListMember<typeof engine.REFERENCED_ENTITY_KINDS>
        >,
        Equal<engine.ReferencedEntity['kind'], engine.ReferencedEntityKind>,
      ]
    >(),
  REFUSAL_CODES:
    unionsEqual<
      [
        Equal<engine.RefusalCode, ListMember<typeof engine.REFUSAL_CODES>>,
        Equal<engine.RefusedTable['code'], engine.RefusalCode>,
      ]
    >(),
  REQUIRED_REASON_CODES:
    unionsEqual<
      [
        Equal<
          engine.RequiredReasonCode,
          ListMember<typeof engine.REQUIRED_REASON_CODES>
        >,
        Equal<engine.RequiredReason['code'], engine.RequiredReasonCode>,
      ]
    >(),
  ROW_COLUMNS:
    unionsEqual<
      [
        Equal<engine.RowColumn, ListMember<typeof engine.ROW_COLUMNS>>,
        Equal<engine.DraftColumnChange['column'], engine.RowColumn>,
      ]
    >(),
  ROW_SELECTION_STATES:
    unionsEqual<
      [
        Equal<
          engine.RowSelectionState,
          ListMember<typeof engine.ROW_SELECTION_STATES>
        >,
        Equal<engine.RowSelection['state'], engine.RowSelectionState>,
      ]
    >(),
  SELECTOR_SIDES:
    unionsEqual<
      [
        Equal<engine.SelectorSide, ListMember<typeof engine.SELECTOR_SIDES>>,
        Equal<NonNullable<engine.TableRef['side']>, engine.SelectorSide>,
      ]
    >(),
  STALE_CHANGES:
    unionsEqual<
      [
        Equal<engine.StaleChange, ListMember<typeof engine.STALE_CHANGES>>,
        Equal<engine.ChangesStale['changed'][number], engine.StaleChange>,
      ]
    >(),
  STRUCTURE_FIELD_CHANGES:
    unionsEqual<
      [
        Equal<
          engine.StructureFieldChange,
          ListMember<typeof engine.STRUCTURE_FIELD_CHANGES>
        >,
        Equal<engine.ChangedField['change'], engine.StructureFieldChange>,
      ]
    >(),
  STRUCTURE_TABLE_CHANGES:
    unionsEqual<
      [
        Equal<
          engine.StructureTableChange,
          ListMember<typeof engine.STRUCTURE_TABLE_CHANGES>
        >,
        Equal<engine.StructureChange['table'], engine.StructureTableChange>,
      ]
    >(),
  TABLE_SELECTION_STATES:
    unionsEqual<
      [
        Equal<
          engine.TableSelectionState,
          ListMember<typeof engine.TABLE_SELECTION_STATES>
        >,
        Equal<engine.TableSelection['state'], engine.TableSelectionState>,
      ]
    >(),
  UNIT_KINDS:
    unionsEqual<
      [
        Equal<engine.UnitKind, ListMember<typeof engine.UNIT_KINDS>>,
        Equal<engine.Unit['kind'], engine.UnitKind>,
      ]
    >(),
};

type Edge<Page extends { readonly edges: readonly unknown[] }> =
  Page['edges'][number];

type Variant<Union, State> = Extract<Union, { readonly state: State }>;

// Every object a result of the seven operations holds has an exported name, and the result types use it.
const RESULT_PARTS_HAVE_THEIR_NAMES = unionsEqual<
  [
    Equal<
      NonNullable<engine.SelectableTableSelection['tableData']>,
      engine.TableData
    >,
    Equal<Edge<engine.DraftTablePage>, engine.DraftEdge<engine.DraftTableItem>>,
    Equal<Edge<engine.DraftRowPage>, engine.DraftEdge<engine.DraftRowItem>>,
    Equal<
      engine.DraftChangesSummary['tablesSummary'],
      engine.DraftTablesSummary
    >,
    Equal<
      engine.PlanEstimate['mixedTables'][number],
      engine.MixedTableEstimate
    >,
    Equal<
      engine.ChangesBlocked,
      engine.PlannedChangesBlocked | engine.StoppedChangesBlocked
    >,
    Equal<
      Variant<engine.RowSelection, 'selectable'>,
      {
        readonly units: readonly engine.UnitRef[];
      } & engine.SelectableRowSelection
    >,
  ]
>();

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
      values: [...Object.keys(CODE_LISTS), ...CHANGES_FEATURE_VALUES].sort(
        compareCodePoints,
      ),
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

  it('derives every code union, variant fields included, from its runtime list', () => {
    expect(Object.keys(CODE_UNIONS_EQUAL_THEIR_LISTS)).toEqual(
      Object.keys(CODE_LISTS),
    );
  });

  it('names every object type that a result holds', () => {
    expect(RESULT_PARTS_HAVE_THEIR_NAMES).toBe(true);
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
