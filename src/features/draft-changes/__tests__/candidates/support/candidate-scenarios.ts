import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  buildCatalogue,
  givenCatalogueScenario,
  givenTwoTableCatalogueScenario,
  type CatalogueScenarioOptions,
} from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  givenSchemaProjection,
  givenSchemaPatchGroups,
  moveField,
  numberField,
  objectSchema,
  project,
  rowInput,
  rootHistory,
  requiredProjected,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import { resolveSelection } from 'src/features/draft-changes/__tests__/selection/support/selection-fixture';
import type {
  CalculateDataCandidatesQueryData,
  CalculateDataCandidatesResult,
  ResolvedDraftChangesSelection,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesSelection } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import { CalculateDataCandidatesHandler } from 'src/features/draft-changes/queries/handlers/calculate-data-candidates.handler';
import { CalculateDataCandidatesQuery } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { ProjectDraftChangesSchemaHandler } from 'src/features/draft-changes/queries/handlers/project-draft-changes-schema.handler';
import { ProjectDraftChangesSchemaQuery } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { QueryBus } from '@nestjs/cqrs';
import type { Cache } from '@nestjs/cache-manager';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';

export const CANDIDATE_ROW_ID = 'row-product';
export const NEW_TABLE_CREATED_ID = 'new-table-created';
export const PRODUCT_TABLE_ID = 'stable-products';

export function productFields(paths: string[]): DraftChangesSelection {
  return rowFields('products', CANDIDATE_ROW_ID, paths);
}
export async function givenSelectedCandidate(options: {
  operation: 'commit' | 'discard';
  selection?: DraftChangesSelection;
  scenario?: CatalogueScenarioOptions;
  deniedSchemaChangePath?: string;
}): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  catalogue: DraftChangesCatalogue;
}> {
  const scenario = await givenCatalogueScenario(
    options.scenario ?? {
      headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head', price: 10 })],
      draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', price: 20 })],
    },
  );
  const catalogue = await buildCatalogue(scenario);
  const requested = options.selection ?? {
    include: [{ kind: 'all' as const }],
  };
  const deniedEntry = options.deniedSchemaChangePath
    ? catalogue.entries.find(
        (entry) =>
          entry.kind === 'schemaField' &&
          entry.path === options.deniedSchemaChangePath,
      )
    : undefined;
  const selection = deniedEntry
    ? {
        ...requested,
        exclude: [
          ...(requested.exclude ?? []),
          { kind: 'change' as const, ref: deniedEntry.ref },
        ],
      }
    : requested;
  const resolution = await resolveSelection(catalogue, selection);
  const candidateData = selectedCandidateData(
    scenario.snapshot,
    catalogue,
    options.operation,
    requireResolvedSelection(resolution),
  );
  return {
    data: candidateData,
    catalogue,
  };
}

export async function givenDiscardWithDeniedRenamedField(
  denial: 'path' | 'change',
): Promise<Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>> {
  const headSchema = schemaWith({ old: stringField(), note: stringField() });
  const renamed = givenSchemaPatchGroups(headSchema, [
    [moveField('/properties/old', '/properties/new')],
  ]);
  const scenario = await givenCatalogueScenario({
    headSchema,
    draftSchema: renamed.terminalSchema,
    pending: renamed.steps,
    headRows: [rowInput(CANDIDATE_ROW_ID, { old: 'Head', note: 'Head' })],
    draftRows: [rowInput(CANDIDATE_ROW_ID, { new: 'Draft', note: 'Draft' })],
  });
  const catalogue = await buildCatalogue(scenario);
  const renamedValue = requireRowFieldEntry(catalogue, '/new');
  const denied =
    denial === 'change'
      ? [{ kind: 'change' as const, ref: renamedValue.ref }]
      : [
          {
            kind: 'rowFields' as const,
            tableId: 'products',
            rowId: CANDIDATE_ROW_ID,
            paths: ['/new'],
          },
        ];
  const resolution = await resolveSelection(catalogue, {
    include: rowFields('products', CANDIDATE_ROW_ID, ['/note']).include,
    exclude: denied,
  });
  return selectedCandidateData(
    scenario.snapshot,
    catalogue,
    'discard',
    requireResolvedSelection(resolution),
  );
}

export async function givenCommitCreatedRowWithDeniedTableRename(): Promise<
  Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>
> {
  const schema = schemaWith({ title: stringField(), price: numberField() });
  const scenario = await givenCatalogueScenario({
    headSchema: schema,
    draftSchema: schema,
    headTableId: 'products',
    draftTableId: 'renamed-products',
    headRows: [rowInput('existing-row', { title: 'Existing', price: 1 })],
    draftRows: [
      rowInput('existing-row', { title: 'Existing', price: 1 }),
      rowInput('created-row', { title: 'Created', price: 2 }),
    ],
  });
  const catalogue = await buildCatalogue(scenario);
  const rowEntry = requireRowLifecycleEntry(catalogue, 'created-row');
  const tableEntry = requireTableEntry(catalogue);
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: rowEntry.ref }],
    exclude: [{ kind: 'change', ref: tableEntry.ref }],
  });
  return selectedCandidateData(
    scenario.snapshot,
    catalogue,
    'commit',
    requireResolvedSelection(resolution),
  );
}

export async function givenCommitNoteWithDeniedSchemaRename(): Promise<
  Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>
> {
  const headSchema = schemaWith({ old: stringField(), note: stringField() });
  const renamed = givenSchemaPatchGroups(headSchema, [
    [moveField('/properties/old', '/properties/new')],
  ]);
  const scenario = await givenCatalogueScenario({
    headSchema,
    draftSchema: renamed.terminalSchema,
    pending: renamed.steps,
    headRows: [rowInput(CANDIDATE_ROW_ID, { old: 'Head', note: 'Head' })],
    draftRows: [rowInput(CANDIDATE_ROW_ID, { new: 'Draft', note: 'Draft' })],
  });
  const catalogue = await buildCatalogue(scenario);
  const note = requireRowFieldEntry(catalogue, '/note');
  const schemaRename = requireSchemaEntry(catalogue, '/properties/new');
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: note.ref }],
    exclude: [{ kind: 'change', ref: schemaRename.ref }],
  });
  return selectedCandidateData(
    scenario.snapshot,
    catalogue,
    'commit',
    requireResolvedSelection(resolution),
  );
}

export async function givenCommitChildSchemaWithDeniedParentMove(): Promise<
  Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>
> {
  const headSchema = schemaWith({
    oldParent: objectSchema({ child: stringField(), sibling: stringField() }),
  });
  const changed = givenSchemaPatchGroups(headSchema, [
    [
      {
        op: 'replace',
        path: '/properties/oldParent/properties/child',
        value: numberField(),
      },
    ],
    [moveField('/properties/oldParent', '/properties/newParent')],
  ]);
  const scenario = await givenCatalogueScenario({
    headSchema,
    draftSchema: changed.terminalSchema,
    pending: changed.steps,
    headRows: [
      rowInput(CANDIDATE_ROW_ID, {
        oldParent: { child: '1', sibling: 'Head sibling' },
      }),
    ],
    draftRows: [
      rowInput(CANDIDATE_ROW_ID, {
        newParent: { child: 7, sibling: 'Draft sibling' },
      }),
    ],
  });
  const catalogue = await buildCatalogue(scenario);
  const childSchema = requireSchemaEntry(
    catalogue,
    '/properties/newParent/properties/child',
  );
  const parentMove = requireSchemaEntry(catalogue, '/properties/newParent');
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: childSchema.ref }],
    exclude: [{ kind: 'change', ref: parentMove.ref }],
  });
  return selectedCandidateData(
    scenario.snapshot,
    catalogue,
    'commit',
    requireResolvedSelection(resolution),
  );
}

export async function givenDiscardWithCollidingRenamedRemainder(): Promise<
  Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>
> {
  const headSchema = schemaWith({ old: stringField() });
  const renamed = givenSchemaPatchGroups(headSchema, [
    [moveField('/properties/old', '/properties/new')],
  ]);
  const scenario = await givenCatalogueScenario({
    headSchema,
    draftSchema: renamed.terminalSchema,
    pending: renamed.steps,
    headRows: [rowInput(CANDIDATE_ROW_ID, { old: 'Head' })],
    draftRows: [rowInput(CANDIDATE_ROW_ID, { new: 'Head', old: 'rogue' })],
  });
  const catalogue = await buildCatalogue(scenario);
  const schemaRename = requireSchemaEntry(catalogue, '/properties/new');
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: schemaRename.ref }],
  });
  return selectedCandidateData(
    scenario.snapshot,
    catalogue,
    'discard',
    requireResolvedSelection(resolution),
  );
}

export async function givenDiscardWithEqualCollidingRenamedRemainder(): Promise<
  Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>
> {
  const headSchema = schemaWith({ old: stringField() });
  const renamed = givenSchemaPatchGroups(headSchema, [
    [moveField('/properties/old', '/properties/new')],
  ]);
  const scenario = await givenCatalogueScenario({
    headSchema,
    draftSchema: renamed.terminalSchema,
    pending: renamed.steps,
    headRows: [rowInput(CANDIDATE_ROW_ID, { old: 'Head' })],
    draftRows: [rowInput(CANDIDATE_ROW_ID, { new: 'Head', old: 'Head' })],
  });
  const catalogue = await buildCatalogue(scenario);
  const schemaRename = requireSchemaEntry(catalogue, '/properties/new');
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: schemaRename.ref }],
  });
  return selectedCandidateData(
    scenario.snapshot,
    catalogue,
    'discard',
    requireResolvedSelection(resolution),
  );
}

export async function givenRenamedFieldDiscardCandidate(
  required: boolean,
): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  catalogue: DraftChangesCatalogue;
}> {
  const headSchema = schemaWith(
    { old: stringField(), note: stringField() },
    required ? ['old', 'note'] : ['note'],
  );
  const renamed = givenSchemaPatchGroups(headSchema, [
    [moveField('/properties/old', '/properties/new')],
  ]);
  return givenSelectedCandidate({
    operation: 'discard',
    selection: {
      include: [
        ...schemaFields('products', ['/properties/new']).include,
        ...rowFields('products', CANDIDATE_ROW_ID, ['/new']).include,
      ],
    },
    scenario: {
      headSchema,
      draftSchema: renamed.terminalSchema,
      pending: renamed.steps,
      headRows: [rowInput(CANDIDATE_ROW_ID, { old: 'Head', note: 'Head' })],
      draftRows: [rowInput(CANDIDATE_ROW_ID, { new: 'Draft', note: 'Draft' })],
    },
  });
}

export async function givenRenamedChildWithDeniedDraftField(): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
}> {
  const headSchema = schemaWith({
    oldParent: objectSchema({ child: stringField(), sibling: stringField() }),
  });
  const changed = givenSchemaPatchGroups(headSchema, [
    [
      {
        op: 'replace',
        path: '/properties/oldParent/properties/child',
        value: numberField(),
      },
    ],
    [moveField('/properties/oldParent', '/properties/newParent')],
  ]);
  const candidate = await givenSelectedCandidate({
    operation: 'commit',
    selection: {
      include: schemaFields('products', [
        '/properties/newParent/properties/child',
      ]).include,
      exclude: rowFields('products', CANDIDATE_ROW_ID, ['/newParent/child'])
        .include,
    },
    scenario: {
      headSchema,
      draftSchema: changed.terminalSchema,
      pending: changed.steps,
      headRows: [
        rowInput(CANDIDATE_ROW_ID, { oldParent: { child: 'H', sibling: 'S' } }),
      ],
      draftRows: [
        rowInput(CANDIDATE_ROW_ID, { newParent: { child: 7, sibling: 'S' } }),
      ],
    },
  });
  return { data: candidate.data };
}

export async function givenSchemaChangeDeniedByExactFieldRef(): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
}> {
  const headSchema = schemaWith({ child: stringField() });
  const changed = givenSchemaPatchGroups(headSchema, [
    [{ op: 'replace', path: '/properties/child', value: numberField() }],
  ]);
  const scenario = await givenCatalogueScenario({
    headSchema,
    draftSchema: changed.terminalSchema,
    pending: changed.steps,
    headRows: [rowInput(CANDIDATE_ROW_ID, { child: 'H' })],
    draftRows: [rowInput(CANDIDATE_ROW_ID, { child: 7 })],
  });
  const catalogue = await buildCatalogue(scenario);
  const field = requireRowFieldEntry(catalogue, '/child');
  const resolution = await resolveSelection(catalogue, {
    include: schemaFields('products', ['/properties/child']).include,
    exclude: [{ kind: 'change', ref: field.ref }],
  });
  return {
    data: selectedCandidateData(
      scenario.snapshot,
      catalogue,
      'commit',
      requireResolvedSelection(resolution),
    ),
  };
}

export async function givenRenamedInvalidDraftRemainder(): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
}> {
  const headSchema = schemaWith({
    oldParent: objectSchema({ child: stringField(), sibling: stringField() }),
  });
  const renamed = givenSchemaPatchGroups(headSchema, [
    [moveField('/properties/oldParent', '/properties/newParent')],
  ]);
  const candidate = await givenSelectedCandidate({
    operation: 'discard',
    selection: schemaFields('products', ['/properties/newParent']),
    scenario: {
      headSchema,
      draftSchema: renamed.terminalSchema,
      pending: renamed.steps,
      headRows: [
        rowInput(CANDIDATE_ROW_ID, { oldParent: { child: 'H', sibling: 'S' } }),
      ],
      draftRows: [
        rowInput(CANDIDATE_ROW_ID, {
          newParent: { child: 'H', sibling: 'S', rogue: true },
        }),
      ],
    },
  });
  return { data: candidate.data };
}
export function selectedCandidateData(
  snapshot: DraftChangesSnapshot,
  catalogue: DraftChangesCatalogue,
  operation: 'commit' | 'discard',
  selection: ResolvedDraftChangesSelection,
): Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }> {
  return { snapshot, operation, mode: 'selected', catalogue, selection };
}
export async function givenNewTableRowCandidate(
  options: {
    denyTableCreation?: boolean;
  } = {},
): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  catalogue: DraftChangesCatalogue;
}> {
  const schema = objectSchema({ title: stringField(), price: numberField() });
  const scenario = givenSchemaProjection({
    tableCreatedId: NEW_TABLE_CREATED_ID,
    headSchema: schema,
    draftSchema: schema,
    missingHeadTable: true,
    headRows: [],
    draftRows: [
      rowInput('selected-row', { title: 'Selected', price: 10 }),
      rowInput('sibling-row', { title: 'Sibling', price: 20 }),
    ],
  });
  const catalogue = await buildCatalogue({
    snapshot: scenario.snapshot,
    schemaProjections: [],
  });
  const tableEntry = catalogue.entries.find(
    (entry) =>
      entry.kind === 'table' &&
      entry.target.kind === 'table' &&
      entry.target.tableCreatedId === NEW_TABLE_CREATED_ID,
  );
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'rows', tableId: 'products', rowIds: ['selected-row'] }],
    exclude:
      options.denyTableCreation && tableEntry
        ? [{ kind: 'change', ref: tableEntry.ref }]
        : [],
  });
  return {
    data: {
      snapshot: scenario.snapshot,
      operation: 'commit',
      mode: 'selected',
      catalogue,
      selection: requireResolvedSelection(resolution),
    },
    catalogue,
  };
}
export async function givenTableIdSwapCandidate(
  operation: 'commit' | 'discard',
): Promise<Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>> {
  const scenario = await givenTwoTableCatalogueScenario();
  const snapshot = scenario.snapshot;
  const stableIds = [
    scenario.tableCreatedId,
    'stable-secondary-products',
  ] as const;
  const roleNames = {
    head: {
      [scenario.tableCreatedId]: 'products',
      'stable-secondary-products': 'secondary-products',
    },
    draft: {
      [scenario.tableCreatedId]: 'secondary-products',
      'stable-secondary-products': 'products',
    },
  };

  for (const revision of [snapshot.head, snapshot.draft]) {
    for (const tableCreatedId of stableIds) {
      const table = revision.tables.find(
        (candidate) => candidate.createdId === tableCreatedId,
      );
      const schemas = revision.tables.find(
        (candidate) => candidate.id === SystemTables.Schema,
      );
      const schemaCreatedId =
        tableCreatedId === scenario.tableCreatedId
          ? 'schema-products-created'
          : 'schema-secondary-created';
      const schema = schemas?.rows.find(
        (candidate) => candidate.createdId === schemaCreatedId,
      );
      if (!table || !schemas || !schema) {
        throw new Error('Expected each table to have its schema row.');
      }
      const role = revision === snapshot.draft ? 'draft' : 'head';
      const id = roleNames[role][tableCreatedId];
      if (!id) {
        throw new Error(
          `No public ID configured for table '${tableCreatedId}'.`,
        );
      }
      table.id = id;
      schema.id = id;
    }
  }

  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  const schemaProjections = await Promise.all(
    stableIds.map(async (tableCreatedId) => ({
      tableCreatedId,
      projection: requiredProjected(
        await project({
          snapshot,
          tableCreatedId,
          operation: 'commit',
          effects: [],
        }),
      ),
    })),
  );
  const catalogue = await buildCatalogue({ snapshot, schemaProjections });
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'all' }],
  });
  return selectedCandidateData(
    snapshot,
    catalogue,
    operation,
    requireResolvedSelection(resolution),
  );
}

export async function givenTableIdSwapWithTemporaryNameCollision(): Promise<
  Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>
> {
  const scenario = await givenTwoTableCatalogueScenario();
  const snapshot = scenario.snapshot;
  const tableCreatedId = scenario.tableCreatedId;
  const secondaryCreatedId = 'stable-secondary-products';
  const collisionCreatedId = 'stable-collision-table';
  const schemaCreatedIds = {
    [tableCreatedId]: 'schema-products-created',
    [secondaryCreatedId]: 'schema-secondary-created',
  };
  const collisionId = `__candidate_${tableCreatedId}`;
  const roleNames = {
    head: { [tableCreatedId]: 'products', [secondaryCreatedId]: 'archive' },
    draft: { [tableCreatedId]: 'archive', [secondaryCreatedId]: 'products' },
  };

  for (const revision of [snapshot.head, snapshot.draft]) {
    const schemaTable = revision.tables.find(
      ({ id }) => id === SystemTables.Schema,
    );
    const sourceTable = revision.tables.find(
      ({ createdId }) => createdId === secondaryCreatedId,
    );
    const sourceSchemaRow = schemaTable?.rows.find(
      ({ id }) => id === sourceTable?.id,
    );
    if (!schemaTable || !sourceTable || !sourceSchemaRow) {
      throw new Error('Expected the source table and schema row.');
    }

    const collisionTable = structuredClone(sourceTable);
    collisionTable.createdId = collisionCreatedId;
    collisionTable.id = collisionId;
    revision.tables.push(collisionTable);

    const collisionSchemaRow = structuredClone(sourceSchemaRow);
    collisionSchemaRow.createdId = 'schema-collision-created';
    collisionSchemaRow.id = collisionId;
    const collisionHistory = rootHistory(collisionSchemaRow.data as JsonSchema);
    collisionHistory.date = '2026-01-02T00:00:00.000Z';
    collisionSchemaRow.meta = [collisionHistory];
    schemaTable.rows.unshift(collisionSchemaRow);

    const role = revision === snapshot.draft ? 'draft' : 'head';
    for (const [createdId, publicId] of Object.entries(roleNames[role])) {
      const table = revision.tables.find(
        (candidate) => candidate.createdId === createdId,
      );
      const schemaRow = schemaTable.rows.find(
        (candidate) => candidate.createdId === schemaCreatedIds[createdId],
      );
      if (!table || !schemaRow) {
        throw new Error(`Expected stable identity '${createdId}'.`);
      }
      table.id = publicId;
      schemaRow.id = publicId;
    }
  }

  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });

  const schemaProjections = await Promise.all(
    [tableCreatedId, secondaryCreatedId, collisionCreatedId].map(
      async (createdId) => ({
        tableCreatedId: createdId,
        projection: requiredProjected(
          await project({
            snapshot,
            tableCreatedId: createdId,
            operation: 'commit',
            effects: [],
          }),
        ),
      }),
    ),
  );
  const catalogue = await buildCatalogue({ snapshot, schemaProjections });
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'all' }],
  });
  return selectedCandidateData(
    snapshot,
    catalogue,
    'commit',
    requireResolvedSelection(resolution),
  );
}

export async function givenCreatedTablesWithPublicIdCollision(): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  tableCreatedId: string;
  tableSchema: JsonSchema;
}> {
  const scenario = await givenTwoTableCatalogueScenario();
  const snapshot = scenario.snapshot;
  const primaryCreatedId = scenario.tableCreatedId;
  const secondaryCreatedId = 'stable-secondary-products';
  const schemaRowIds = new Set([
    'schema-products-created',
    'schema-secondary-created',
  ]);
  const secondaryTableSchema = schemaWith({ label: stringField() });

  const headSchemaTable = snapshot.head.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  if (!headSchemaTable) {
    throw new Error('Expected the Head schema table.');
  }
  snapshot.head.tables = snapshot.head.tables.filter(
    ({ createdId }) =>
      createdId !== primaryCreatedId && createdId !== secondaryCreatedId,
  );
  headSchemaTable.rows = headSchemaTable.rows.filter(
    ({ createdId }) => !schemaRowIds.has(createdId),
  );

  const draftTables = new Map(
    snapshot.draft.tables.map((table) => [table.createdId, table]),
  );
  const primary = draftTables.get(primaryCreatedId);
  const secondary = draftTables.get(secondaryCreatedId);
  const draftSchemaTable = snapshot.draft.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const primarySchema = draftSchemaTable?.rows.find(
    ({ createdId }) => createdId === 'schema-products-created',
  );
  const secondarySchemaRow = draftSchemaTable?.rows.find(
    ({ createdId }) => createdId === 'schema-secondary-created',
  );
  if (
    !primary ||
    !secondary ||
    !draftSchemaTable ||
    !primarySchema ||
    !secondarySchemaRow
  ) {
    throw new Error('Expected both Draft tables and their schema rows.');
  }
  primary.id = 'created-primary';
  primarySchema.id = primary.id;
  secondary.id = primaryCreatedId;
  secondarySchemaRow.id = secondary.id;
  secondarySchemaRow.data = secondaryTableSchema as JsonValue;
  secondarySchemaRow.meta = [rootHistory(secondaryTableSchema)];
  secondarySchemaRow.hash = objectHash(secondaryTableSchema);

  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  const catalogue = await buildCatalogue({ snapshot, schemaProjections: [] });
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'all' }],
  });
  return {
    data: selectedCandidateData(
      snapshot,
      catalogue,
      'commit',
      requireResolvedSelection(resolution),
    ),
    tableCreatedId: primaryCreatedId,
    tableSchema: primarySchema.data as JsonSchema,
  };
}
export async function givenCaseInsensitiveTableConflictCandidate(): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  conflictingRef: DraftChangesCatalogueEntry['ref'];
}> {
  const scenario = await givenTwoTableCatalogueScenario();
  const snapshot = scenario.snapshot;
  const secondaryCreatedId = 'stable-secondary-products';
  const stableIds = [scenario.tableCreatedId, secondaryCreatedId];
  const headNames = {
    [scenario.tableCreatedId]: 'Products',
    [secondaryCreatedId]: 'Archive',
  };
  const draftNames = {
    [scenario.tableCreatedId]: 'ARCHIVE',
    [secondaryCreatedId]: 'archive-old',
  };
  setCandidateTableIds(
    snapshot,
    scenario.tableCreatedId,
    headNames,
    draftNames,
  );

  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  const schemaProjections = await Promise.all(
    stableIds.map(async (tableCreatedId) => ({
      tableCreatedId,
      projection: requiredProjected(
        await project({
          snapshot,
          tableCreatedId,
          operation: 'commit',
          effects: [],
        }),
      ),
    })),
  );
  const catalogue = await buildCatalogue({ snapshot, schemaProjections });
  const selectedEntry = catalogue.entries.find(
    (entry) =>
      entry.kind === 'table' &&
      entry.target.kind === 'table' &&
      entry.target.tableCreatedId === scenario.tableCreatedId,
  );
  const conflictingEntry = catalogue.entries.find(
    (entry) =>
      entry.kind === 'table' &&
      entry.target.kind === 'table' &&
      entry.target.tableCreatedId === secondaryCreatedId,
  );
  if (!selectedEntry || !conflictingEntry) {
    throw new Error('Expected both table rename entries.');
  }
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: selectedEntry.ref }],
  });
  return {
    data: selectedCandidateData(
      snapshot,
      catalogue,
      'commit',
      requireResolvedSelection(resolution),
    ),
    conflictingRef: conflictingEntry.ref,
  };
}
function setCandidateTableIds(
  snapshot: DraftChangesSnapshot,
  primaryCreatedId: string,
  headNames: Record<string, string>,
  draftNames: Record<string, string>,
): void {
  const schemaCreatedIds = {
    [primaryCreatedId]: 'schema-products-created',
    'stable-secondary-products': 'schema-secondary-created',
  };
  for (const [revision, names] of [
    [snapshot.head, headNames],
    [snapshot.draft, draftNames],
  ] as const) {
    const schemaTable = revision.tables.find(
      ({ id }) => id === SystemTables.Schema,
    );
    for (const tableCreatedId of Object.keys(names)) {
      const table = revision.tables.find(
        (candidate) => candidate.createdId === tableCreatedId,
      );
      const schemaCreatedId = schemaCreatedIds[tableCreatedId];
      const schemaRow = schemaTable?.rows.find(
        (candidate) => candidate.createdId === schemaCreatedId,
      );
      const tableId = names[tableCreatedId];
      if (
        !table ||
        !schemaTable ||
        !schemaRow ||
        !schemaCreatedId ||
        !tableId
      ) {
        throw new Error(`Expected source table identity '${tableCreatedId}'.`);
      }
      table.id = tableId;
      schemaRow.id = tableId;
    }
  }
}
export async function givenSelectedRowLifecycleCandidate(options: {
  operation: 'commit' | 'discard';
  rowCreatedId: string;
  scenario: CatalogueScenarioOptions;
}): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  catalogue: DraftChangesCatalogue;
}> {
  const scenario = await givenCatalogueScenario(options.scenario);
  const catalogue = await buildCatalogue(scenario);
  const entry = requireRowLifecycleEntry(catalogue, options.rowCreatedId);
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: entry.ref }],
  });
  return {
    data: selectedCandidateData(
      scenario.snapshot,
      catalogue,
      options.operation,
      requireResolvedSelection(resolution),
    ),
    catalogue,
  };
}
export async function givenSelectedTableLifecycleCandidate(options: {
  operation: 'commit' | 'discard';
  tableCreatedId?: string;
  scenario: CatalogueScenarioOptions;
}): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  catalogue: DraftChangesCatalogue;
}> {
  const scenario = await givenCatalogueScenario(options.scenario);
  const catalogue = await buildCatalogue(scenario);
  const tableEntry = catalogue.entries.find(
    (entry) =>
      entry.kind === 'table' &&
      entry.target.kind === 'table' &&
      entry.target.tableCreatedId ===
        (options.tableCreatedId ?? scenario.tableCreatedId),
  );
  if (!tableEntry) {
    throw new Error('Expected table lifecycle change.');
  }
  const resolution = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: tableEntry.ref }],
  });
  return {
    data: selectedCandidateData(
      scenario.snapshot,
      catalogue,
      options.operation,
      requireResolvedSelection(resolution),
    ),
    catalogue,
  };
}
export async function givenOneSidedTableCandidate(options: {
  side: 'head' | 'draft';
  operation: 'commit' | 'discard';
  rows: Array<{ createdId: string; data: JsonValue }>;
  selection: DraftChangesSelection;
}): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  catalogue: DraftChangesCatalogue;
}> {
  const schema = objectSchema({ title: stringField(), price: numberField() });
  const scenario = givenSchemaProjection({
    tableCreatedId: NEW_TABLE_CREATED_ID,
    headSchema: schema,
    draftSchema: schema,
    missingHeadTable: options.side === 'draft',
    missingDraftTable: options.side === 'head',
    headRows: options.side === 'head' ? options.rows : [],
    draftRows: options.side === 'draft' ? options.rows : [],
  });
  const catalogue = await buildCatalogue({
    snapshot: scenario.snapshot,
    schemaProjections: [],
  });
  const resolution = await resolveSelection(catalogue, options.selection);
  return {
    data: selectedCandidateData(
      scenario.snapshot,
      catalogue,
      options.operation,
      requireResolvedSelection(resolution),
    ),
    catalogue,
  };
}
export function rowFields(
  tableId: string,
  rowId: string,
  paths: string[],
): DraftChangesSelection {
  return {
    include: [{ kind: 'rowFields', tableId, rowId, paths }],
  };
}
export function rowLifecycle(
  tableId: string,
  rowIds: 'all' | string[],
): DraftChangesSelection {
  return { include: [{ kind: 'rows', tableId, rowIds }] };
}
export function schemaFields(
  tableId: string,
  paths: string[],
): DraftChangesSelection {
  return {
    include: [{ kind: 'schemaFields', tableId, paths }],
  };
}
export function requireSchemaEntry(
  catalogue: DraftChangesCatalogue,
  path: string,
): DraftChangesCatalogueEntry {
  const entry = catalogue.entries.find(
    (candidate) => candidate.kind === 'schemaField' && candidate.path === path,
  );
  if (!entry || entry.kind !== 'schemaField') {
    throw new Error(`Expected schema change at '${path}'.`);
  }
  return entry;
}
export function requireRowFieldEntry(
  catalogue: DraftChangesCatalogue,
  path: string,
): DraftChangesCatalogueEntry {
  const entry = catalogue.entries.find(
    (candidate) => candidate.kind === 'rowField' && candidate.path === path,
  );
  if (!entry || entry.kind !== 'rowField') {
    throw new Error(`Expected row field change at '${path}'.`);
  }
  return entry;
}
export function requireTableEntry(
  catalogue: DraftChangesCatalogue,
): DraftChangesCatalogueEntry {
  const entry = catalogue.entries.find(
    (candidate) => candidate.kind === 'table',
  );
  if (!entry || entry.kind !== 'table') {
    throw new Error('Expected table lifecycle change.');
  }
  return entry;
}
export function requireRowLifecycleEntry(
  catalogue: DraftChangesCatalogue,
  rowCreatedId: string,
): DraftChangesCatalogueEntry {
  const entry = catalogue.entries.find(
    (candidate) =>
      candidate.kind === 'row' &&
      candidate.target.kind === 'row' &&
      candidate.target.rowCreatedId === rowCreatedId,
  );
  if (!entry || entry.kind !== 'row') {
    throw new Error(`Expected row lifecycle change '${rowCreatedId}'.`);
  }
  return entry;
}
export async function givenRestoreHeadCandidate(
  scenarioOptions: CatalogueScenarioOptions = {},
): Promise<Extract<CalculateDataCandidatesQueryData, { mode: 'restoreHead' }>> {
  const scenario = await givenCatalogueScenario(scenarioOptions);
  return {
    snapshot: scenario.snapshot,
    operation: 'discard',
    mode: 'restoreHead',
  };
}
export function calculateCandidate(
  data: CalculateDataCandidatesQueryData,
): Promise<CalculateDataCandidatesResult> {
  const schemaHandler = new ProjectDraftChangesSchemaHandler();
  const queryBus = {
    execute: (query: ProjectDraftChangesSchemaQuery) =>
      schemaHandler.execute(query),
  } as unknown as QueryBus;
  return new CalculateDataCandidatesHandler(
    queryBus,
    candidateValidator(),
  ).execute(new CalculateDataCandidatesQuery(data));
}

function candidateValidator(): JsonSchemaValidatorService {
  const values = new Map<string, unknown>();
  const cache = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => {
      values.set(key, value);
    },
  } as unknown as Cache;
  return new JsonSchemaValidatorService(cache);
}
export function schemaWith(
  properties: Record<string, JsonSchema>,
  required = Object.keys(properties),
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...required].sort(),
    properties,
  };
}
function requireResolvedSelection(
  result: Awaited<ReturnType<typeof resolveSelection>>,
): ResolvedDraftChangesSelection {
  if (result.status !== 'resolved') {
    throw new Error(
      `Expected resolved selection, received '${result.status}'.`,
    );
  }
  return result;
}
