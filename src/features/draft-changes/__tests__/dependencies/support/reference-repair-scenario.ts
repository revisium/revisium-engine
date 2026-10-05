import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateForeignKeyReference } from 'src/features/draft-changes/dependencies/reference-graph';
import type { ResolvedDraftChangesSelection } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { SystemTables } from 'src/features/share/system-tables.consts';

export function givenGroupedForeignKeyRepair(
  options: {
    unrelatedSelectedTable?: string;
  } = {},
) {
  const effectRefs = [
    { historyIndex: 1, patchIndex: 0 },
    { historyIndex: 2, patchIndex: 0 },
  ];
  const originalField = { type: 'string', foreignKey: 'target' };
  const retargetedField = { type: 'string', foreignKey: 'destination' };
  const describedField = {
    ...retargetedField,
    description: 'Independent description',
  };
  const initialSchema = { type: 'object', properties: { link: originalField } };
  const schemaEntry = {
    ref: { value: 'source-link-edit' },
    kind: 'schemaField',
    classification: 'modified',
    target: {
      kind: 'schemaField',
      tableCreatedId: 'source-table',
      tableId: 'source',
      path: '/properties/link',
    },
    path: '/properties/link',
    effectRefs,
    before: originalField,
    after: describedField,
    afterExists: true,
  } as unknown as DraftChangesCatalogueEntry;
  const deletion = {
    ref: { value: 'target-deletion' },
    kind: 'table',
    classification: 'deleted',
    target: {
      kind: 'table',
      tableCreatedId: 'target-table',
      tableId: 'target',
    },
  } as unknown as DraftChangesCatalogueEntry;
  const selected: DraftChangesCatalogueEntry[] = [deletion];
  if (options.unrelatedSelectedTable) {
    selected.push({
      ...schemaEntry,
      ref: { value: 'unrelated-schema-effect' },
      target: {
        kind: 'schemaField',
        tableCreatedId: options.unrelatedSelectedTable,
        tableId: 'other',
        path: '/properties/name',
      },
      path: '/properties/name',
    });
  }
  const state = {
    tables: [
      { id: 'source', createdId: 'source-table', rows: [] },
      {
        id: SystemTables.Schema,
        createdId: 'schema-table',
        rows: [
          {
            id: 'source',
            createdId: 'source-schema-row',
            data: initialSchema,
            meta: [
              {
                patches: [{ op: 'add', path: '', value: initialSchema }],
                hash: 'initial',
                date: '2026-01-01T00:00:00.000Z',
              },
              {
                patches: [
                  {
                    op: 'replace',
                    path: '/properties/link',
                    value: retargetedField,
                  },
                ],
                hash: 'retargeted',
                date: '2026-01-02T00:00:00.000Z',
              },
              {
                patches: [
                  {
                    op: 'replace',
                    path: '/properties/link',
                    value: describedField,
                  },
                ],
                hash: 'described',
                date: '2026-01-03T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    ],
  } as unknown as DraftRevisionState;
  const snapshot = {
    head: { tables: [] },
    draft: state,
  } as unknown as DraftChangesSnapshot;
  const reference: CandidateForeignKeyReference = {
    kind: 'schema',
    role: 'head',
    tableCreatedId: 'source-table',
    tableId: 'source',
    targetTableId: 'target',
    path: '/properties/link',
    schemaPath: '/properties/link',
  };
  return {
    input: {
      snapshot,
      operation: 'commit' as const,
      candidateRole: 'head' as const,
      reference,
      selected: selected as ResolvedDraftChangesSelection['selected'],
      catalogue: { entries: [schemaEntry, deletion] } as DraftChangesCatalogue,
    },
    expectedCause: deletion.ref,
    requiredEffects: effectRefs,
  };
}
