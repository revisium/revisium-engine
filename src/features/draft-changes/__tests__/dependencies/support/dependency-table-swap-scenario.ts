import objectHash from 'object-hash';
import { buildCatalogue } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  givenTableIdSwapCandidate,
  schemaWith,
} from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import {
  givenSchemaPatchGroups,
  givenSchemaProjection,
  numberField,
  project,
  requiredProjected,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import { resolveSelection } from 'src/features/draft-changes/__tests__/selection/support/selection-fixture';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import type { CalculateDataCandidatesQueryData } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import { selectedCandidateData } from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { SystemTables } from 'src/features/share/system-tables.consts';

const PRIMARY_ID = 'stable-products';
const SECONDARY_ID = 'stable-secondary-products';
const STABLE_TABLE_IDS = [PRIMARY_ID, SECONDARY_ID] as const;

export async function givenSwappedTablesWithIndependentDraftForeignKey(): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  targetRenameRef: DraftChangesCatalogueEntry['ref'];
}> {
  const base = await givenTableIdSwapCandidate('commit');
  const snapshot = structuredClone(base.snapshot);
  setSecondaryTargetRow(snapshot.head);
  setSecondaryTargetRow(snapshot.draft);
  const headSchema = schemaWith({
    title: stringField(),
    price: numberField(),
    link: {
      type: 'string',
      default: '',
      foreignKey: 'secondary-products',
      description: 'Head link',
    },
  });
  const draftLink = {
    type: 'string' as const,
    default: '',
    foreignKey: 'secondary-products',
    description: 'Draft independent target',
  };
  const draftSchema = schemaWith({
    title: stringField(),
    price: numberField(),
    link: draftLink,
  });
  const history = givenSchemaPatchGroups(headSchema, [
    [
      {
        op: 'replace',
        path: '/properties/link',
        value: draftLink,
      },
    ],
  ]);
  const primary = givenSchemaProjection({
    tableCreatedId: PRIMARY_ID,
    headTableId: 'products',
    draftTableId: 'secondary-products',
    headSchema,
    draftSchema,
    pending: history.steps,
    headRows: [
      rowInput('source-row', { title: 'Head', price: 1, link: 'target-row' }),
    ],
    draftRows: [
      rowInput('source-row', { title: 'Draft', price: 2, link: 'source-row' }),
    ],
  });
  replaceTable(snapshot.head, primary.snapshot.head, PRIMARY_ID);
  replaceTable(snapshot.draft, primary.snapshot.draft, PRIMARY_ID);
  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });

  const schemaProjections = await Promise.all(
    STABLE_TABLE_IDS.map(async (tableCreatedId) => ({
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
  const renameEntries = catalogue.entries.filter(
    (entry) =>
      entry.kind === 'table' &&
      entry.classification === 'renamed' &&
      entry.target.kind === 'table' &&
      STABLE_TABLE_IDS.includes(
        entry.target.tableCreatedId as (typeof STABLE_TABLE_IDS)[number],
      ),
  );
  const targetRename = renameEntries.find(
    (entry) =>
      entry.target.kind === 'table' &&
      entry.target.tableCreatedId === SECONDARY_ID,
  );
  if (renameEntries.length !== STABLE_TABLE_IDS.length || !targetRename) {
    throw new Error('Expected both stable table identities to be renamed.');
  }
  const selection = await resolveSelection(catalogue, {
    include: renameEntries.map((entry) => ({
      kind: 'change' as const,
      ref: entry.ref,
    })),
  });
  if (selection.status !== 'resolved') {
    throw new Error('Expected the simultaneous table rename selection.');
  }
  return {
    data: selectedCandidateData(snapshot, catalogue, 'commit', selection),
    targetRenameRef: targetRename.ref,
  };
}

function replaceTable(
  targetState: DraftChangesSnapshot['head'],
  sourceState: DraftChangesSnapshot['head'],
  tableCreatedId: string,
): void {
  const targetIndex = targetState.tables.findIndex(
    (table) => table.createdId === tableCreatedId,
  );
  const sourceTable = sourceState.tables.find(
    (table) => table.createdId === tableCreatedId,
  );
  if (targetIndex < 0 || !sourceTable) {
    throw new Error(`Expected table identity '${tableCreatedId}'.`);
  }
  targetState.tables[targetIndex] = structuredClone(sourceTable);
  const targetSchemaTable = targetState.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const sourceSchemaTable = sourceState.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const sourceSchema = sourceSchemaTable?.rows.find(
    ({ createdId }) => createdId === 'schema-products-created',
  );
  const targetSchema = targetSchemaTable?.rows.find(
    ({ createdId }) => createdId === 'schema-products-created',
  );
  if (
    !targetSchemaTable ||
    !sourceSchemaTable ||
    !sourceSchema ||
    !targetSchema
  ) {
    throw new Error('Expected the primary schema row in both snapshots.');
  }
  targetSchemaTable.rows[targetSchemaTable.rows.indexOf(targetSchema)] =
    structuredClone(sourceSchema);
}

function setSecondaryTargetRow(state: DraftChangesSnapshot['head']): void {
  const table = state.tables.find(
    ({ createdId }) => createdId === SECONDARY_ID,
  );
  const primaryRow = state.tables.find(
    ({ createdId }) => createdId === PRIMARY_ID,
  )?.rows[0];
  if (!table || !primaryRow) {
    throw new Error('Expected the source table row for the target fixture.');
  }
  const row = table.rows[0] ?? structuredClone(primaryRow);
  if (table.rows.length === 0) {
    table.rows.push(row);
  }
  row.createdId = 'target-row-created';
  row.id = 'target-row';
  row.data = { title: 'Target', price: 3 };
  row.hash = objectHash(row.data);
}
