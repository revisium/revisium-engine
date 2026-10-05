import type { JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import {
  buildCatalogue,
  givenCatalogueScenario,
} from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  schemaWith,
  selectedCandidateData,
} from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import {
  givenSchemaPatchGroups,
  givenSchemaProjection,
  moveField,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import { resolveSelection } from 'src/features/draft-changes/__tests__/selection/support/selection-fixture';
import {
  project,
  requiredProjected,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-results';
import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { CalculateDataCandidatesQueryData } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import { ResolveCandidateDependenciesHandler } from 'src/features/draft-changes/queries/handlers/resolve-candidate-dependencies.handler';
import { CalculateDataCandidatesHandler } from 'src/features/draft-changes/queries/handlers/calculate-data-candidates.handler';
import { ProjectDraftChangesSchemaHandler } from 'src/features/draft-changes/queries/handlers/project-draft-changes-schema.handler';
import { CalculateDataCandidatesQuery } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { ProjectDraftChangesSchemaQuery } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type { QueryBus } from '@nestjs/cqrs';
import {
  ResolveCandidateDependenciesQuery,
  type ResolveCandidateDependenciesQueryData,
  type ResolveCandidateDependenciesResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';

export function resolveDependencies(
  data: ResolveCandidateDependenciesQueryData,
): Promise<ResolveCandidateDependenciesResult> {
  return new ResolveCandidateDependenciesHandler(
    createCandidateQueryBus(),
    new JsonSchemaStoreService(),
  ).execute(new ResolveCandidateDependenciesQuery(data));
}

function createCandidateQueryBus(): QueryBus {
  const cache = {
    get: async () => undefined,
    set: async () => undefined,
  };
  const validator = new JsonSchemaValidatorService(cache as never);
  const schemaHandler = new ProjectDraftChangesSchemaHandler();
  const candidateHandlerRef: { current?: CalculateDataCandidatesHandler } = {};
  const bus = {
    execute: async (query: unknown) => {
      if (query instanceof ProjectDraftChangesSchemaQuery) {
        return schemaHandler.execute(query);
      }
      if (query instanceof CalculateDataCandidatesQuery) {
        return candidateHandlerRef.current?.execute(query);
      }
      throw new Error('Unexpected candidate query in dependency fixture.');
    },
  } as QueryBus;
  candidateHandlerRef.current = new CalculateDataCandidatesHandler(
    bus,
    validator,
  );
  return bus;
}

export async function givenForeignKeyRestoreHead(
  reference: string,
): Promise<ResolveCandidateDependenciesQueryData> {
  const schema = schemaWith({
    title: { type: 'string', default: '' },
    price: { type: 'number', default: 0 },
    reference: {
      type: 'string',
      default: '',
      foreignKey: 'secondary-products',
    } as JsonSchema,
  });
  const scenario = await givenCatalogueScenario({
    headSchema: schema,
    draftSchema: schema,
    headRows: [rowInput('product', { title: 'Head', price: 1, reference })],
    draftRows: [rowInput('product', { title: 'Draft', price: 2, reference })],
  });
  for (const role of ['head', 'draft'] as const) {
    const state = scenario.snapshot[role];
    const sourceTable = requiredTable(state, 'stable-products');
    const targetTable = structuredClone(sourceTable);
    targetTable.createdId = 'stable-secondary-products';
    targetTable.id = 'secondary-products';
    targetTable.versionId = `${role}-secondary-table-version`;
    targetTable.rows = [];
    const sourceRow = sourceTable.rows[0];
    if (!sourceRow) {
      throw new Error(`Expected ${role} source row fixture.`);
    }
    const targetRow = structuredClone(sourceRow);
    targetRow.id = '';
    targetRow.createdId = 'empty-target-row';
    targetRow.versionId = `${role}-empty-target-version`;
    targetRow.data = { title: 'Target', price: 3, reference: '' };
    targetRow.hash = objectHash(targetRow.data);
    targetTable.rows.push(targetRow);
    state.tables.push(targetTable);

    const schemaTable = state.tables.find(
      ({ id }) => id === SystemTables.Schema,
    );
    const sourceSchema = requiredSchemaRow(state, sourceTable.id);
    if (!schemaTable) {
      throw new Error(`Expected ${role} schema table fixture.`);
    }
    const targetSchema = structuredClone(sourceSchema);
    targetSchema.id = targetTable.id;
    targetSchema.createdId = 'schema-secondary-created';
    targetSchema.versionId = `${role}-secondary-schema-version`;
    schemaTable.rows.push(targetSchema);
  }
  scenario.snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: scenario.snapshot.branch,
    head: scenario.snapshot.head,
    draft: scenario.snapshot.draft,
  });
  return {
    snapshot: scenario.snapshot,
    operation: 'discard',
    mode: 'restoreHead',
  };
}

export async function givenSelfTableRenameWithForeignKey(
  options: {
    fromTableId?: string;
    toTableId?: string;
    deniedSchemaPath?: string;
  } = {},
): Promise<{
  data: Extract<ResolveCandidateDependenciesQueryData, { mode: 'selected' }>;
  causeRef: DraftChangesCatalogue['entries'][number]['ref'];
  fromTableId: string;
  toTableId: string;
}> {
  const fromTableId = options.fromTableId ?? 'products';
  const toTableId = options.toTableId ?? 'renamed-products';
  const headLink: JsonSchema = {
    type: 'string',
    default: fromTableId,
    foreignKey: fromTableId,
    description: 'Head link',
  };
  const draftLink = {
    ...headLink,
    foreignKey: toTableId,
    description: 'Draft link',
  };
  const headSchema = schemaWith({ link: headLink, note: stringField() });
  const pending = givenSchemaPatchGroups(headSchema, [
    [
      {
        op: 'replace',
        path: '/properties/link',
        value: draftLink,
      },
    ],
  ]);
  const scenario = await givenCatalogueScenario({
    headSchema,
    draftSchema: pending.terminalSchema,
    pending: pending.steps,
    headTableId: fromTableId,
    draftTableId: toTableId,
    headRows: [rowInput('product', { link: 'product', note: 'Head' })],
    draftRows: [rowInput('product', { link: 'product', note: 'Draft' })],
  });
  const catalogue = await buildCatalogue(scenario);
  const tableChange = catalogue.entries.find(
    (entry) => entry.kind === 'table' && entry.classification === 'renamed',
  );
  if (!tableChange) {
    throw new Error('Expected a table rename entry.');
  }
  const selection = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: tableChange.ref }],
    ...(options.deniedSchemaPath === undefined
      ? {}
      : {
          exclude: [
            {
              kind: 'schemaFields' as const,
              tableId: toTableId,
              paths: [options.deniedSchemaPath],
            },
          ],
        }),
  });
  if (selection.status !== 'resolved') {
    throw new Error('Expected the table rename selection to resolve.');
  }
  return {
    data: selectedCandidateData(
      scenario.snapshot,
      catalogue,
      'commit',
      selection,
    ),
    causeRef: tableChange.ref,
    fromTableId,
    toTableId,
  };
}

export async function givenSelfRowRenameWithForeignKey(
  operation: 'commit' | 'discard',
  denyRowField = false,
): Promise<{
  data: Extract<ResolveCandidateDependenciesQueryData, { mode: 'selected' }>;
  causeRef: DraftChangesCatalogue['entries'][number]['ref'];
}> {
  const schema = schemaWith({
    link: {
      type: 'string',
      default: '',
      foreignKey: 'products',
    } as JsonSchema,
    note: stringField(),
  });
  const scenario = await givenCatalogueScenario({
    headSchema: schema,
    draftSchema: schema,
    headRows: [rowInput('product', { link: 'product', note: 'Head' })],
    draftRows: [
      rowInput('product', { link: 'renamed-product', note: 'Draft' }),
    ],
    headRowIds: { product: 'product' },
    draftRowIds: { product: 'renamed-product' },
  });
  const catalogue = await buildCatalogue(scenario);
  const rowRename = catalogue.entries.find(
    (entry) =>
      entry.kind === 'row' &&
      entry.classification === 'renamed' &&
      entry.target.kind === 'row' &&
      entry.target.rowCreatedId === 'product',
  );
  if (!rowRename) {
    throw new Error('Expected a self row rename entry.');
  }
  const selection = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: rowRename.ref }],
    ...(denyRowField
      ? {
          exclude: [
            {
              kind: 'rowFields' as const,
              tableId: 'products',
              rowId: operation === 'commit' ? 'product' : 'renamed-product',
              paths: ['/link'],
            },
          ],
        }
      : {}),
  });
  if (selection.status !== 'resolved') {
    throw new Error('Expected the row rename selection to resolve.');
  }
  return {
    data: selectedCandidateData(
      scenario.snapshot,
      catalogue,
      operation,
      selection,
    ),
    causeRef: rowRename.ref,
  };
}

export async function givenMovedSelfTableRenameWithForeignKey(): Promise<
  Extract<ResolveCandidateDependenciesQueryData, { mode: 'selected' }>
> {
  const headLink: JsonSchema = {
    type: 'string',
    default: 'products',
    foreignKey: 'products',
    description: 'Head link',
  };
  const movedLink = { ...headLink };
  const draftLink: JsonSchema = {
    ...movedLink,
    foreignKey: 'renamed-products',
    description: 'Draft link',
  };
  const headSchema = schemaWith({ oldLink: headLink, note: stringField() });
  const pending = givenSchemaPatchGroups(headSchema, [
    [moveField('/properties/oldLink', '/properties/link')],
    [
      {
        op: 'replace',
        path: '/properties/link',
        value: draftLink,
      },
    ],
  ]);
  const scenario = await givenCatalogueScenario({
    headSchema,
    draftSchema: pending.terminalSchema,
    pending: pending.steps,
    headTableId: 'products',
    draftTableId: 'renamed-products',
    headRows: [rowInput('product', { oldLink: 'product', note: 'Head' })],
    draftRows: [rowInput('product', { link: 'product', note: 'Draft' })],
  });
  const catalogue = await buildCatalogue(scenario);
  const tableChange = catalogue.entries.find(
    (entry) => entry.kind === 'table' && entry.classification === 'renamed',
  );
  if (!tableChange) {
    throw new Error('Expected a table rename entry after schema movement.');
  }
  const selection = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: tableChange.ref }],
  });
  if (selection.status !== 'resolved') {
    throw new Error('Expected the moved table rename selection to resolve.');
  }
  return selectedCandidateData(
    scenario.snapshot,
    catalogue,
    'commit',
    selection,
  );
}

export async function givenLinkedTargetCandidate(options: {
  targetRows: Array<{ createdId: string; data: Record<string, string> }>;
  headTargetRows?: Array<{ createdId: string; data: Record<string, string> }>;
  excludeRequiredTarget?: boolean;
  sourceCreatedRow?: boolean;
  sourceReference?: string;
  defaultReferenceField?: boolean;
  reusedTarget?: {
    headRowCreatedId: string;
    draftRowCreatedId: string;
    publicId: string;
  };
}): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  sourceChange: DraftChangesCatalogueEntry;
  requiredTargetRef?: DraftChangesCatalogueEntry['ref'];
  targetLifecycleRefs: DraftChangesCatalogueEntry['ref'][];
  oldTargetRef?: DraftChangesCatalogueEntry['ref'];
}> {
  const sourceReference =
    options.sourceReference ??
    (options.defaultReferenceField ? '' : 'required-target');
  const sourceProjection = givenLinkedSourceProjection(
    options,
    sourceReference,
  );
  const targetSchema = schemaWith({ code: stringField() });
  const targetProjection = givenSchemaProjection({
    tableCreatedId: 'stable-secondary-products',
    headTableId: 'secondary-products',
    draftTableId: 'secondary-products',
    headSchema: targetSchema,
    draftSchema: targetSchema,
    headRows: options.headTargetRows ?? [],
    draftRows: options.targetRows,
  });
  if (options.reusedTarget) {
    setTargetRowPublicId(
      targetProjection.snapshot.head,
      options.reusedTarget.headRowCreatedId,
      options.reusedTarget.publicId,
    );
    setTargetRowPublicId(
      targetProjection.snapshot.draft,
      options.reusedTarget.draftRowCreatedId,
      options.reusedTarget.publicId,
    );
  }
  const snapshot = structuredClone(sourceProjection.snapshot);
  appendTargetTable(snapshot, targetProjection.snapshot);
  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  const schemaProjections = await Promise.all(
    ['stable-products', 'stable-secondary-products'].map(
      async (tableCreatedId) => ({
        tableCreatedId,
        projection: requiredProjected(
          await project({
            snapshot,
            tableCreatedId,
            operation: 'commit',
            effects: [],
          }),
        ),
      }),
    ),
  );
  const catalogue = await buildCatalogue({ snapshot, schemaProjections });
  const sourceChange = findLinkedSourceChange(catalogue, options);
  if (!sourceChange) {
    throw new Error('Expected the source FK value change entry.');
  }
  const targetChanges = catalogue.entries.filter(
    (entry) =>
      entry.kind === 'row' &&
      entry.target.kind === 'row' &&
      entry.target.tableCreatedId === 'stable-secondary-products',
  );
  const requiredTarget = targetChanges.find(
    (entry) =>
      entry.classification === 'created' &&
      entry.target.kind === 'row' &&
      entry.target.rowCreatedId === 'required-target',
  );
  if (!requiredTarget && !options.defaultReferenceField) {
    throw new Error('Expected required target row lifecycle entry.');
  }
  const oldTarget = options.reusedTarget
    ? targetChanges.find(
        (entry) =>
          entry.classification === 'deleted' &&
          entry.target.kind === 'row' &&
          entry.target.rowCreatedId === options.reusedTarget?.headRowCreatedId,
      )
    : undefined;
  if (options.reusedTarget && !oldTarget) {
    throw new Error('Expected the replaced target row lifecycle entry.');
  }
  const selection = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: sourceChange.ref }],
    ...(options.excludeRequiredTarget && requiredTarget
      ? { exclude: [{ kind: 'change' as const, ref: requiredTarget.ref }] }
      : {}),
  });
  if (selection.status !== 'resolved') {
    throw new Error('Expected the source FK value selection to resolve.');
  }
  return {
    data: selectedCandidateData(snapshot, catalogue, 'commit', selection),
    sourceChange,
    ...(requiredTarget ? { requiredTargetRef: requiredTarget.ref } : {}),
    targetLifecycleRefs: [
      ...(oldTarget ? [oldTarget.ref] : []),
      ...(requiredTarget ? [requiredTarget.ref] : []),
    ],
    ...(oldTarget ? { oldTargetRef: oldTarget.ref } : {}),
  };
}

function findLinkedSourceChange(
  catalogue: DraftChangesCatalogue,
  options: Parameters<typeof givenLinkedTargetCandidate>[0],
): DraftChangesCatalogueEntry | undefined {
  if (options.defaultReferenceField) {
    return catalogue.entries.find(
      (entry) =>
        entry.kind === 'schemaField' && entry.path === '/properties/link',
    );
  }
  if (options.sourceCreatedRow) {
    return catalogue.entries.find(
      (entry) =>
        entry.kind === 'row' &&
        entry.classification === 'created' &&
        entry.target.kind === 'row' &&
        entry.target.tableCreatedId === 'stable-products' &&
        entry.target.rowCreatedId === 'source-created',
    );
  }
  return catalogue.entries.find(
    (entry) =>
      entry.kind === 'rowField' &&
      entry.target.kind === 'rowField' &&
      entry.target.tableCreatedId === 'stable-products' &&
      entry.target.rowCreatedId === 'source-row' &&
      entry.path === '/link',
  );
}

function givenLinkedSourceProjection(
  options: Parameters<typeof givenLinkedTargetCandidate>[0],
  sourceReference: string,
) {
  const linkSchema = {
    type: 'string',
    default: '',
    foreignKey: 'secondary-products',
  } as JsonSchema;
  const headSchema = options.defaultReferenceField
    ? schemaWith({ note: stringField() })
    : schemaWith({ link: linkSchema, note: stringField() });
  const draftSchema = schemaWith({ link: linkSchema, note: stringField() });
  const schemaHistory = options.defaultReferenceField
    ? givenSchemaPatchGroups(headSchema, [
        [
          {
            op: 'add' as const,
            path: '/properties/link',
            value: linkSchema,
          },
        ],
      ])
    : undefined;
  const sourceProjection = givenSchemaProjection({
    tableCreatedId: 'stable-products',
    headTableId: 'products',
    draftTableId: 'products',
    headSchema,
    draftSchema,
    pending: schemaHistory?.steps,
    headRows: options.sourceCreatedRow
      ? []
      : [
          rowInput(
            'source-row',
            options.defaultReferenceField
              ? { note: 'Head' }
              : { link: '', note: 'Head' },
          ),
        ],
    draftRows: options.sourceCreatedRow
      ? [rowInput('source-created', { link: sourceReference, note: 'New' })]
      : [
          rowInput('source-row', {
            link: sourceReference,
            note: 'Draft',
          }),
        ],
  });
  return sourceProjection;
}

function setTargetRowPublicId(
  state: DraftChangesSnapshot['head'],
  rowCreatedId: string,
  publicId: string,
): void {
  const targetTable = requiredTable(state, 'stable-secondary-products');
  const row = targetTable.rows.find(
    (candidate) => candidate.createdId === rowCreatedId,
  );
  if (!row) {
    throw new Error(`Expected target row '${rowCreatedId}'.`);
  }
  row.id = publicId;
}

function appendTargetTable(
  snapshot: DraftChangesSnapshot,
  targetSnapshot: DraftChangesSnapshot,
): void {
  for (const role of ['head', 'draft'] as const) {
    const targetState = targetSnapshot[role];
    const sourceState = snapshot[role];
    const targetTable = requiredTable(targetState, 'stable-secondary-products');
    const targetSchemaTable = targetState.tables.find(
      ({ id }) => id === SystemTables.Schema,
    );
    const targetSchemaRow = targetSchemaTable?.rows.find(
      ({ id }) => id === targetTable.id,
    );
    const sourceSchemaTable = sourceState.tables.find(
      ({ id }) => id === SystemTables.Schema,
    );
    if (!targetSchemaRow || !sourceSchemaTable) {
      throw new Error(`Expected ${role} target schema fixture.`);
    }
    sourceState.tables.push(structuredClone(targetTable));
    const schemaRow = structuredClone(targetSchemaRow);
    schemaRow.createdId = 'schema-secondary-created';
    sourceSchemaTable.rows.push(schemaRow);
  }
}

export function rowIds(
  state: DraftRevisionState,
  tableCreatedId: string,
): string[] {
  return requiredTable(state, tableCreatedId).rows.map(({ id }) => id);
}

export function rowCreatedIds(
  state: DraftRevisionState,
  tableCreatedId: string,
): string[] {
  return requiredTable(state, tableCreatedId).rows.map(
    ({ createdId }) => createdId,
  );
}

function requiredTable<
  T extends DraftRevisionState | DraftChangesSnapshot['head'],
>(state: T, createdId: string): T['tables'][number] {
  const table = state.tables.find(
    (candidate) => candidate.createdId === createdId,
  );
  if (!table) {
    throw new Error(`Expected table fixture '${createdId}'.`);
  }
  return table;
}

function requiredSchemaRow<
  T extends DraftRevisionState | DraftChangesSnapshot['head'],
>(state: T, tableId: string): T['tables'][number]['rows'][number] {
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const row = schemaTable?.rows.find((candidate) => candidate.id === tableId);
  if (!row) {
    throw new Error(`Expected schema row fixture '${tableId}'.`);
  }
  return row;
}

export function schemaForTable(
  state: DraftRevisionState | DraftChangesSnapshot['head'],
  tableId: string,
): JsonSchema {
  const schemaRow = requiredSchemaRow(state, tableId);
  return schemaRow.data as JsonSchema;
}
