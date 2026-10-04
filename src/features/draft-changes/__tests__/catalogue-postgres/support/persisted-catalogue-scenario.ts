import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { givenDraftProjectWithSchema } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { DraftChangesModule } from 'src/features/draft-changes/draft-changes.module';
import type {
  BuildDraftChangesCatalogueResult,
  DraftChangesCatalogueEntry,
  DraftChangeRef,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';

export async function createPersistedCatalogueTestKit() {
  const kit = await createDraftTestKit({
    imports: [DraftChangesModule],
    migrationOptions: { workerMode: 'disabled' },
  });
  const changes = kit.module.get(DraftChangesApiService);

  const givenProduct = async (
    schema: JsonSchema = getObjectSchema({
      price: getNumberSchema(),
      title: getStringSchema(),
    }),
    data: Record<string, unknown> = { price: 10, title: 'Head' },
  ) => {
    const fixture = await givenDraftProjectWithSchema({
      prismaService: kit.prismaService,
      schema,
      tableId: 'products',
      row: { rowId: 'product', data },
    });
    const location = {
      revisionId: fixture.draftRevisionId,
      tableId: fixture.tableId,
    };
    const readSnapshot = () =>
      changes.readSnapshot({
        projectId: fixture.projectId,
        branchName: fixture.branchName,
      });
    const catalogue = async () => {
      const snapshot = await readSnapshot();
      const tables = findSharedTables(snapshot);
      const schemaProjections = await Promise.all(
        tables.map(async (table) => ({
          tableCreatedId: table.createdId,
          projection: await changes.projectSchema({
            snapshot,
            tableCreatedId: table.createdId,
            operation: 'commit',
            effects: [],
          }),
        })),
      );
      return requireCatalogue(
        await changes.buildCatalogue({ snapshot, schemaProjections }),
      );
    };
    return {
      readSnapshot,
      catalogue,
      createdRowReference: async () =>
        requireChangeReference(
          (await catalogue()).entries.find(
            ({ kind, classification }) =>
              kind === 'row' && classification === 'created',
          ),
        ),
      rowFieldReference: async () =>
        requireChangeReference(
          (await catalogue()).entries.find(({ kind }) => kind === 'rowField'),
        ),
      editNestedChild: (parentId = 'oldParent') =>
        kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [
            {
              op: 'replace',
              path: `/properties/${parentId}/properties/child`,
              value: getNumberSchema(),
            },
          ],
        }),
      renameNestedParent: () =>
        kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [
            {
              op: 'move',
              from: '/properties/oldParent',
              path: '/properties/newParent',
            },
          ],
        }),
      projectNestedChild: async () => {
        const snapshot = await readSnapshot();
        const selected = await changes.resolveSelection({
          catalogue: await catalogue(),
          selection: {
            include: [
              {
                kind: 'schemaFields',
                tableId: fixture.tableId,
                paths: ['/properties/newParent/properties/child'],
              },
            ],
          },
        });
        if (selected.status !== 'resolved') {
          throw new Error(
            `Expected child selection: ${JSON.stringify(selected)}`,
          );
        }
        const table = snapshot.draft.tables.find(
          ({ id }) => id === fixture.tableId,
        );
        if (!table) {
          throw new Error('Expected persisted nested products table.');
        }
        return changes.projectSchema({
          snapshot,
          tableCreatedId: table.createdId,
          operation: 'commit',
          effects: selected.selected.flatMap(
            ({ effectRefs }) => effectRefs ?? [],
          ),
        });
      },
      recreateTitleAsNumber: async () => {
        await kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [{ op: 'remove', path: '/properties/title' }],
        });
        await kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [
            { op: 'add', path: '/properties/title', value: getNumberSchema() },
          ],
        });
      },
      catalogueFromDiscardProjection: async () => {
        const snapshot = await readSnapshot();
        const table = snapshot.draft.tables.find(
          ({ id }) => id === fixture.tableId,
        );
        if (!table) {
          throw new Error('Expected the persisted products table.');
        }
        const projection = await changes.projectSchema({
          snapshot,
          tableCreatedId: table.createdId,
          operation: 'discard',
          effects: [
            { historyIndex: 1, patchIndex: 0 },
            { historyIndex: 2, patchIndex: 0 },
          ],
        });
        return requireCatalogue(
          await changes.buildCatalogue({
            snapshot,
            schemaProjections: [
              { tableCreatedId: table.createdId, projection },
            ],
          }),
        );
      },
      addAndRenameExtra: async () => {
        await kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [
            { op: 'add', path: '/properties/extra', value: getStringSchema() },
          ],
        });
        await kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [
            {
              op: 'move',
              from: '/properties/extra',
              path: '/properties/renamed',
            },
          ],
        });
      },
      renamePriceTwice: async () => {
        await kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [
            { op: 'move', from: '/properties/price', path: '/properties/cost' },
          ],
        });
        await kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [
            {
              op: 'move',
              from: '/properties/cost',
              path: '/properties/amount',
            },
          ],
        });
      },
      editAmount: () =>
        kit.draftApiService.apiUpdateRow({
          ...location,
          rowId: fixture.rowId,
          data: { amount: 25, title: 'Head' },
        }),
      addDefaultField: () =>
        kit.draftApiService.apiUpdateTable({
          ...location,
          patches: [
            { op: 'add', path: '/properties/extra', value: getNumberSchema() },
          ],
        }),
      editTitle: (title: string) =>
        kit.draftApiService.apiUpdateRow({
          ...location,
          rowId: fixture.rowId,
          data: { price: 10, title },
        }),
      tamperTitleKeepingHash: (title: string) =>
        kit.prismaService.row.update({
          where: { versionId: fixture.draftRowVersionId },
          data: { data: { price: 10, title } },
        }),
      replaceRowIdentity: async () => {
        await kit.draftApiService.apiRemoveRow({
          ...location,
          rowId: fixture.rowId,
        });
        await kit.draftApiService.apiCreateRow({
          ...location,
          rowId: fixture.rowId,
          data: { price: 42, title: 'Replacement' },
        });
      },
      selectRows: async () =>
        changes.resolveSelection({
          catalogue: await catalogue(),
          selection: {
            include: [
              {
                kind: 'rows',
                tableId: fixture.tableId,
                rowIds: [fixture.rowId],
              },
            ],
          },
        }),
      selectSchemaFields: async (paths: string[]) =>
        changes.resolveSelection({
          catalogue: await catalogue(),
          selection: {
            include: [
              { kind: 'schemaFields', tableId: fixture.tableId, paths },
            ],
          },
        }),
      selectRef: async (ref: DraftChangeRef) =>
        changes.resolveSelection({
          catalogue: await catalogue(),
          selection: { include: [{ kind: 'change', ref }] },
        }),
    };
  };
  return {
    close: () => kit.close(),
    givenProduct,
    givenNestedProduct: () =>
      givenProduct(
        getObjectSchema({
          oldParent: getObjectSchema({
            child: getStringSchema(),
            sibling: getStringSchema(),
          }),
        }),
        { oldParent: { child: 'Child', sibling: 'Sibling' } },
      ),
  };
}

function requireCatalogue(result: BuildDraftChangesCatalogueResult) {
  if (result.status !== 'catalogued') {
    throw new Error(
      `Expected persisted catalogue: ${JSON.stringify(result.blockers)}`,
    );
  }
  return result.catalogue;
}

function findSharedTables(snapshot: DraftChangesSnapshot) {
  const draftIds = new Set(
    snapshot.draft.tables.map(({ createdId }) => createdId),
  );
  return snapshot.head.tables.filter(
    ({ system, createdId }) => !system && draftIds.has(createdId),
  );
}

function requireChangeReference(entry: DraftChangesCatalogueEntry | undefined) {
  if (!entry) {
    throw new Error(
      'Expected a catalogue reference for the persisted scenario.',
    );
  }
  return entry.ref;
}
