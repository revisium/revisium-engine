import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import type { DraftChangesFingerprintInput } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  BuildDraftChangesCatalogueQueryData,
  DraftChangesCatalogue,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { SchemaEffectRef } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { BuildDraftChangesCatalogueQuery } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import { BuildDraftChangesCatalogueHandler } from 'src/features/draft-changes/queries/handlers/build-draft-changes-catalogue.handler';
import { RowDiffService } from 'src/features/revision-changes/services/row-diff.service';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import {
  givenSchemaProjection,
  objectSchema,
  project,
  requiredProjected,
  rowInput,
  stringField,
  numberField,
  type SchemaHistoryStep,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import type { RevisionChangesApiService } from 'src/features/revision-changes/revision-changes-api.service';

export const CATALOGUE_TABLE_CREATED_ID = 'stable-products';
export const CATALOGUE_ROW_CREATED_ID = 'row-product';

export interface CatalogueScenarioOptions {
  tableCreatedId?: string;
  headSchema?: JsonSchema;
  draftSchema?: JsonSchema;
  pending?: SchemaHistoryStep[];
  headRows?: Array<{ createdId: string; data: JsonValue }>;
  draftRows?: Array<{ createdId: string; data: JsonValue }>;
  headRowIds?: Record<string, string>;
  draftRowIds?: Record<string, string>;
  shareStaleRowVersion?: boolean;
  headTableId?: string;
  draftTableId?: string;
  selectedEffects?: SchemaEffectRef[];
  branchId?: string;
  headRevisionId?: string;
  draftRevisionId?: string;
}

export interface CatalogueScenario extends BuildDraftChangesCatalogueQueryData {
  tableCreatedId: string;
}

export async function givenCatalogueScenario(
  options: CatalogueScenarioOptions = {},
): Promise<CatalogueScenario> {
  const schema = objectSchema({
    title: stringField(),
    price: numberField(),
  });
  const projectionInput = givenSchemaProjection({
    headSchema: options.headSchema ?? schema,
    draftSchema: options.draftSchema ?? schema,
    pending: options.pending,
    headRows: options.headRows ?? [
      rowInput(CATALOGUE_ROW_CREATED_ID, { title: 'Head', price: 10 }),
    ],
    draftRows: options.draftRows,
    headTableId: options.headTableId,
    draftTableId: options.draftTableId,
    tableCreatedId: options.tableCreatedId ?? CATALOGUE_TABLE_CREATED_ID,
    selectedEffects: options.selectedEffects,
  });
  if (options.branchId !== undefined) {
    projectionInput.snapshot.branch.id = options.branchId;
  }
  if (options.headRevisionId !== undefined) {
    projectionInput.snapshot.head.id = options.headRevisionId;
  }
  if (options.draftRevisionId !== undefined) {
    projectionInput.snapshot.draft.id = options.draftRevisionId;
  }
  setRowIds(projectionInput.snapshot.head.tables, options.headRowIds);
  setRowIds(projectionInput.snapshot.draft.tables, options.draftRowIds);
  if (options.shareStaleRowVersion) {
    setSharedStoredVersion(projectionInput.snapshot.head.tables);
    setSharedStoredVersion(projectionInput.snapshot.draft.tables);
  }
  projectionInput.snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: projectionInput.snapshot.branch,
    head: projectionInput.snapshot.head,
    draft: projectionInput.snapshot.draft,
  });
  const projection = requiredProjected(await project(projectionInput));
  return {
    snapshot: projectionInput.snapshot,
    tableCreatedId: projectionInput.tableCreatedId,
    schemaProjections: [
      {
        tableCreatedId: projectionInput.tableCreatedId,
        projection,
      },
    ],
  };
}

function setRowIds(
  tables: DraftChangesFingerprintInput['head']['tables'],
  ids: Record<string, string> | undefined,
): void {
  if (!ids) {
    return;
  }
  for (const table of tables) {
    for (const row of table.rows) {
      const id = ids[row.createdId];
      if (id !== undefined) {
        row.id = id;
      }
    }
  }
}

function setSharedStoredVersion(
  tables: DraftChangesFingerprintInput['head']['tables'],
): void {
  for (const table of tables) {
    for (const row of table.rows) {
      if (row.createdId === CATALOGUE_ROW_CREATED_ID) {
        row.versionId = 'deliberately-reused-version';
        row.hash = 'deliberately-stale-hash';
      }
    }
  }
}

export async function buildCatalogue(
  data: BuildDraftChangesCatalogueQueryData,
): Promise<DraftChangesCatalogue> {
  const result = await catalogueResult(data);
  if (result.status !== 'catalogued') {
    throw new Error(
      `Expected catalogue, received blockers: ${result.blockers.map(({ code }) => code).join(', ')}`,
    );
  }
  return result.catalogue;
}

export async function catalogueResult(
  data: BuildDraftChangesCatalogueQueryData,
) {
  const diff = new RowDiffService();
  const revisionChangesApi = {
    compareSuppliedRows: async ({
      pairs,
    }: {
      pairs: Array<{ key: string; fromData: JsonValue; toData: JsonValue }>;
    }) => ({
      pairs: pairs.map(({ key, fromData, toData }) => ({
        key,
        fieldChanges: diff.analyzeFieldChanges(fromData, toData),
      })),
    }),
  };
  return new BuildDraftChangesCatalogueHandler(
    revisionChangesApi as unknown as RevisionChangesApiService,
  ).execute(new BuildDraftChangesCatalogueQuery(data));
}

export function requiredScenarioProjection(scenario: CatalogueScenario) {
  const projection = scenario.schemaProjections[0];
  if (!projection) {
    throw new Error('Expected a Stage 3 schema projection.');
  }
  return projection;
}

export function requiredTwoScenarioProjections(scenario: CatalogueScenario) {
  const first = scenario.schemaProjections[0];
  const second = scenario.schemaProjections[1];
  if (!first || !second) {
    throw new Error('Expected two table projections.');
  }
  return [
    first,
    { ...second, projection: requiredProjected(second.projection) },
  ] as const;
}

export function duplicateHeadRowIdentity(
  scenario: CatalogueScenario,
  snapshot: BuildDraftChangesCatalogueQueryData['snapshot'],
): void {
  const headTable = snapshot.head.tables.find(
    ({ createdId }) => createdId === scenario.tableCreatedId,
  );
  const row = headTable?.rows[0];
  if (!headTable || !row) {
    throw new Error('Expected a Head row fixture.');
  }
  headTable.rows.push({
    ...structuredClone(row),
    id: 'duplicate-row-version',
    versionId: 'duplicate-version',
  });
}

export function requireRowFieldEntry(
  catalogue: DraftChangesCatalogue,
): Extract<DraftChangesCatalogue['entries'][number], { kind: 'rowField' }> {
  const entry = catalogue.entries.find(({ kind }) => kind === 'rowField');
  if (!entry || entry.target.kind !== 'rowField') {
    throw new Error('Expected a row field entry.');
  }
  return entry as Extract<
    DraftChangesCatalogue['entries'][number],
    { kind: 'rowField' }
  >;
}

export function requireMutableRowFieldTarget(
  entry: DraftChangesCatalogue['entries'][number],
): Extract<
  DraftChangesCatalogue['entries'][number]['target'],
  { kind: 'rowField' }
> {
  if (entry.target.kind !== 'rowField') {
    throw new Error('Expected a row-field target.');
  }
  return entry.target;
}

export function withoutDataTable(
  scenario: CatalogueScenario,
  role: 'head' | 'draft',
): BuildDraftChangesCatalogueQueryData {
  const snapshot = structuredClone(scenario.snapshot);
  snapshot[role].tables = snapshot[role].tables.filter(
    ({ createdId }) => createdId !== scenario.tableCreatedId,
  );
  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  return { snapshot, schemaProjections: [] };
}

export async function reverseSnapshotTableOrder(
  scenario: CatalogueScenario,
): Promise<CatalogueScenario> {
  const snapshot = structuredClone(scenario.snapshot);
  snapshot.head.tables.reverse();
  snapshot.draft.tables.reverse();
  snapshot.head.tables.forEach((table) => table.rows.reverse());
  snapshot.draft.tables.forEach((table) => table.rows.reverse());
  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  const projection = requiredProjected(
    await project({
      snapshot,
      tableCreatedId: scenario.tableCreatedId,
      operation: 'commit',
      effects: [],
    }),
  );
  return {
    snapshot,
    tableCreatedId: scenario.tableCreatedId,
    schemaProjections: [
      { tableCreatedId: scenario.tableCreatedId, projection },
    ],
  };
}

export async function givenTwoTableCatalogueScenario(): Promise<CatalogueScenario> {
  const scenario = await givenCatalogueScenario();
  const snapshot = structuredClone(scenario.snapshot);
  const secondaryId = 'stable-secondary-products';
  for (const revision of [snapshot.head, snapshot.draft]) {
    const primary = revision.tables.find(
      ({ createdId }) => createdId === scenario.tableCreatedId,
    );
    const schema = revision.tables.find(({ id }) => id === SystemTables.Schema);
    const primarySchema = schema?.rows.find(({ id }) => id === primary?.id);
    if (!primary || !schema || !primarySchema) {
      throw new Error(
        'Expected data and schema table fixtures for both tables.',
      );
    }
    const secondaryTable = structuredClone(primary);
    secondaryTable.createdId = secondaryId;
    secondaryTable.id = 'secondary-products';
    secondaryTable.versionId = `${revision.id}-secondary-table`;
    secondaryTable.rows = [];
    revision.tables.push(secondaryTable);
    schema.rows.push({
      ...structuredClone(primarySchema),
      id: secondaryTable.id,
      createdId: 'schema-secondary-created',
      versionId: `${revision.id}-secondary-schema`,
      fileBlobs: [],
    });
  }
  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  const primaryProjection = requiredProjected(
    await project({
      snapshot,
      tableCreatedId: scenario.tableCreatedId,
      operation: 'commit',
      effects: [],
    }),
  );
  const secondaryProjection = requiredProjected(
    await project({
      snapshot,
      tableCreatedId: secondaryId,
      operation: 'commit',
      effects: [],
    }),
  );
  return {
    snapshot,
    tableCreatedId: scenario.tableCreatedId,
    schemaProjections: [
      {
        tableCreatedId: scenario.tableCreatedId,
        projection: primaryProjection,
      },
      { tableCreatedId: secondaryId, projection: secondaryProjection },
    ],
  };
}
