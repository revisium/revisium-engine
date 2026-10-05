import {
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { DraftChangesSelection } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import {
  validateSchemaHistory,
  validateHistoryPrefix,
} from 'src/features/draft-changes/schema/schema-history';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { pluginRefs } from '@revisium/schema-toolkit/lib';
import objectHash from 'object-hash';
import { deepEqual } from '@revisium/schema-toolkit/lib';
import { createPersistedCatalogueTestKit } from '../../catalogue-postgres/support/persisted-catalogue-scenario';

export async function createPersistedDependencyTestKit() {
  const kit = await createPersistedCatalogueTestKit();
  const givenLinkedProduct = async (initialLink = 'product') => {
    const product = await kit.givenProduct(
      getObjectSchema({
        link: linkSchema('products', 'Head'),
        note: getStringSchema(),
      }),
      { link: initialLink, note: 'Head' },
    );
    const originalHead = structuredClone((await product.readSnapshot()).head);
    const linkedTableCreatedId = userTable(originalHead).createdId;
    const linkedRow = userTable(originalHead).rows.find(
      ({ id }) => id === 'product',
    );
    if (!linkedRow) {
      throw new Error('Expected original linked product row.');
    }
    const verifyTableRename = async () => {
      const snapshot = await product.readSnapshot();
      if (
        !deepEqual(linkAttributes(snapshot.head), {
          table: 'products',
          description: 'Head',
        }) ||
        !deepEqual(linkAttributes(snapshot.draft), {
          table: 'renamed-products',
          description: 'Draft',
        })
      ) {
        throw new Error(
          'Native table rename/description preconditions were not preserved.',
        );
      }
    };
    const findReference = async (
      kind: 'table' | 'row' | 'rowField',
      classification?: string,
      path?: string,
      rowId?: string,
    ) => {
      const entry = (await product.catalogue()).entries.find(
        (entry) =>
          entry.kind === kind &&
          (!classification || entry.classification === classification) &&
          (path === undefined || entry.path === path) &&
          (rowId === undefined ||
            ('rowId' in entry.target && entry.target.rowId === rowId)),
      );
      if (!entry) {
        throw new Error('Expected native dependency effect reference.');
      }
      return entry.ref;
    };
    const location = async () => {
      const snapshot = await product.readSnapshot();
      const table = snapshot.draft.tables.find(
        ({ createdId }) => createdId === linkedTableCreatedId,
      );
      if (!table) {
        throw new Error('Expected linked product table.');
      }
      return { revisionId: snapshot.draft.id, tableId: table.id };
    };
    const setDescription = async () => {
      const current = await location();
      await kit.draftApi.apiUpdateTable({
        ...current,
        patches: [
          {
            op: 'replace',
            path: '/properties/link',
            value: linkSchema(current.tableId, 'Draft'),
          },
        ],
      });
    };
    const renameTable = async () =>
      kit.draftApi.apiRenameTable({
        ...(await location()),
        nextTableId: 'renamed-products',
      });
    const resolve = async (
      operation: 'commit' | 'discard',
      selection: DraftChangesSelection,
    ) => {
      const snapshot = await product.readSnapshot();
      const catalogue = await product.catalogue();
      const selected = await kit.changes.resolveSelection({
        catalogue,
        selection,
      });
      if (selected.status !== 'resolved') {
        throw new Error(
          `Invalid dependency fixture selection: ${JSON.stringify(selected)}`,
        );
      }
      return kit.changes.resolveCandidateDependencies({
        snapshot,
        operation,
        mode: 'selected',
        catalogue,
        selection: selected,
      });
    };
    const selectTableRename = async (
      operation: 'commit' | 'discard',
      excluded: DraftChangesSelection['exclude'] = [],
    ) => {
      const catalogue = await product.catalogue();
      const rename = catalogue.entries.find(
        ({ kind, classification }) =>
          kind === 'table' && classification === 'renamed',
      );
      if (!rename) {
        throw new Error('Expected native table rename.');
      }
      return resolve(operation, {
        include: [{ kind: 'change', ref: rename.ref }],
        exclude: excluded,
      });
    };
    return {
      readSnapshot: product.readSnapshot,
      originalHead,
      automaticSchemaRename: async (operation: 'commit' | 'discard') => [
        {
          kind: 'schemaForeignKey',
          role: operation === 'commit' ? 'head' : 'draft',
          tableCreatedId: linkedTableCreatedId,
          targetTableCreatedId: linkedTableCreatedId,
          path: '/properties/link',
          before: operation === 'commit' ? 'products' : 'renamed-products',
          after: operation === 'commit' ? 'renamed-products' : 'products',
          causeRefs: [await findReference('table', 'renamed')],
        },
      ],
      automaticRowRename: async (operation: 'commit' | 'discard') => [
        {
          kind: 'rowForeignKey',
          role: operation === 'commit' ? 'head' : 'draft',
          tableCreatedId: linkedTableCreatedId,
          targetTableCreatedId: linkedTableCreatedId,
          rowCreatedId: linkedRow.createdId,
          targetRowCreatedId: linkedRow.createdId,
          path: '/link',
          before: operation === 'commit' ? 'product' : 'renamed-product',
          after: operation === 'commit' ? 'renamed-product' : 'product',
          causeRefs: [await findReference('row', 'renamed')],
        },
      ],
      requiredTargetEffects: async () => ({
        role: 'head' as const,
        kind: 'catalogueEffects' as const,
        causeRef: await findReference(
          'rowField',
          undefined,
          '/link',
          'product',
        ),
        refs: [
          await findReference('row', 'created', undefined, 'required-target'),
        ],
      }),
      resolve,
      selectTableRename,
      descriptionThenRename: async () => {
        await setDescription();
        await renameTable();
        await verifyTableRename();
      },
      renameThenDescription: async () => {
        await renameTable();
        await setDescription();
        await verifyTableRename();
      },
      renameProductRow: async () =>
        kit.draftApi.apiRenameRow({
          ...(await location()),
          rowId: 'product',
          nextRowId: 'renamed-product',
        }),
      editRenamedNote: async () =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'renamed-product',
          data: { link: 'renamed-product', note: 'Draft' },
        }),
      editReferenceAndNote: async () =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: { link: 'required-target', note: 'Draft' },
        }),
      createRequiredTarget: async () =>
        kit.draftApi.apiCreateRow({
          ...(await location()),
          rowId: 'required-target',
          data: { link: 'product', note: 'Target' },
        }),
      createCycleTarget: async () =>
        kit.draftApi.apiCreateRow({
          ...(await location()),
          rowId: 'cycle-target',
          data: { link: 'required-target', note: 'Cycle' },
        }),
      linkRequiredTargetToCycle: async () =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'required-target',
          data: { link: 'cycle-target', note: 'Target' },
        }),
      cycleEffectRefs: async () =>
        [
          await findReference('row', 'created', undefined, 'required-target'),
          await findReference('row', 'created', undefined, 'cycle-target'),
        ]
          .map((ref) => ref.value)
          .sort(),
      createForeignTable: async () => {
        const { revisionId } = await location();
        await kit.draftApi.apiCreateTable({
          revisionId,
          tableId: 'extras',
          schema: getObjectSchema({ code: getStringSchema() }),
        });
        await kit.draftApi.apiCreateRow({
          revisionId,
          tableId: 'extras',
          rowId: 'product',
          data: { code: 'Target' },
        });
        await kit.draftApi.apiCreateRow({
          revisionId,
          tableId: 'extras',
          rowId: 'sibling',
          data: { code: 'Sibling' },
        });
        await kit.draftApi.apiUpdateTable({
          ...(await location()),
          patches: [
            {
              op: 'replace',
              path: '/properties/link',
              value: linkSchema('extras', 'Head'),
            },
          ],
        });
        await kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: { link: 'product', note: 'Draft' },
        });
      },
      foreignTableEffectRefs: async () =>
        [
          await findReference('table', 'created'),
          await findReference('row', 'created', undefined, 'product'),
        ]
          .map((ref) => ref.value)
          .sort(),
      selectForeignTableSchema: () =>
        resolve('commit', {
          include: [
            {
              kind: 'schemaFields',
              tableId: 'products',
              paths: ['/properties/link'],
            },
          ],
        }),
      createSibling: async () =>
        kit.draftApi.apiCreateRow({
          ...(await location()),
          rowId: 'sibling',
          data: { link: 'product', note: 'Sibling' },
        }),
      selectLink: (
        operation: 'commit' | 'discard',
        excluded: DraftChangesSelection['exclude'] = [],
      ) =>
        resolve(operation, {
          include: [
            {
              kind: 'rowFields',
              tableId: 'products',
              rowId: 'product',
              paths: ['/link'],
            },
          ],
          exclude: excluded,
        }),
      selectRowRename: async (operation: 'commit' | 'discard') => {
        const catalogue = await product.catalogue();
        const rename = catalogue.entries.find(
          ({ kind, classification }) =>
            kind === 'row' && classification === 'renamed',
        );
        if (!rename) {
          throw new Error('Expected native row rename.');
        }
        return resolve(operation, {
          include: [{ kind: 'change', ref: rename.ref }],
        });
      },
    };
  };
  return { close: kit.close, givenLinkedProduct };
}

function linkSchema(tableId: string, description: string) {
  return { ...getStringSchema(), foreignKey: tableId, description };
}

export function linkedSchemas(result: ResolveCandidateDependenciesResult) {
  const resolved = requireResolved(result);
  return {
    head: linkAttributes(resolved.head),
    draft: linkAttributes(resolved.draft),
  };
}

export function linkedRows(
  result: ResolveCandidateDependenciesResult,
  role: 'head' | 'draft',
) {
  const table = userTable(requireResolved(result)[role]);
  return table.rows
    .map(({ id, data }) => ({ id, data }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function schemaHistoryChecks(
  result: ResolveCandidateDependenciesResult,
) {
  const resolved = requireResolved(result);
  const head = schemaRow(resolved.head);
  const draft = schemaRow(resolved.draft);
  const headSchema = head.data as JsonSchema;
  const draftSchema = draft.data as JsonSchema;
  const headHistory = head.meta as unknown as HistoryPatches[];
  const draftHistory = draft.meta as unknown as HistoryPatches[];
  return {
    headReplay:
      validateSchemaHistory(headSchema, headHistory, pluginRefs) === undefined,
    draftReplay:
      validateSchemaHistory(draftSchema, draftHistory, pluginRefs) ===
      undefined,
    prefix: validateHistoryPrefix(headHistory, draftHistory) === undefined,
    headHash: head.hash === objectHash(headSchema),
    draftHash: draft.hash === objectHash(draftSchema),
  };
}

function linkAttributes(state: DraftRevisionState) {
  const schema = schemaRow(state).data as unknown as {
    properties: { link: { foreignKey: string; description: string } };
  };
  return {
    table: schema.properties.link.foreignKey,
    description: schema.properties.link.description,
  };
}

function schemaRow(state: DraftRevisionState) {
  const table = userTable(state);
  const row = state.tables
    .find(({ id }) => id === SystemTables.Schema)
    ?.rows.find(({ id }) => id === table.id);
  if (!row) {
    throw new Error('Expected linked schema row.');
  }
  return row;
}

function userTable(state: DraftRevisionState) {
  const table = state.tables.find(({ system }) => !system);
  if (!table) {
    throw new Error('Expected linked table.');
  }
  return table;
}

export function requireResolved(result: ResolveCandidateDependenciesResult) {
  if (result.status !== 'resolved') {
    throw new Error(
      `Expected resolved dependencies: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

export function headSchemaUnchanged(
  result: ResolveCandidateDependenciesResult,
  originalHead: DraftRevisionState,
) {
  return deepEqual(
    schemaRow(requireResolved(result).head),
    schemaRow(originalHead),
  );
}

export function requiredReferenceValues(
  result: ResolveCandidateDependenciesResult,
) {
  return [
    ...new Set(
      requireResolved(result).required.flatMap((effect) => {
        if (effect.kind !== 'catalogueEffects') {
          throw new Error(
            'Expected only the exact required catalogue effects in this fixture.',
          );
        }
        return effect.refs.map((ref) => ref.value);
      }),
    ),
  ].sort();
}

export function foreignTableRows(
  result: ResolveCandidateDependenciesResult,
  role: 'head' | 'draft',
) {
  const state = requireResolved(result)[role];
  const table = state.tables.find(({ id }) => id === 'extras');
  if (!table) {
    throw new Error('Expected required foreign table.');
  }
  return table.rows
    .map(({ id, data }) => ({ id, data }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function originalProductRows(
  result: ResolveCandidateDependenciesResult,
  role: 'head' | 'draft',
) {
  const table = requireResolved(result)[role].tables.find(
    ({ id }) => id === 'products',
  );
  if (!table) {
    throw new Error('Expected original product table.');
  }
  return table.rows.map(({ id, data }) => ({ id, data }));
}
