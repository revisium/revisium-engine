import {
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type {
  DraftChangesCatalogueEntry,
  DraftChangeRef,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import { createPersistedCatalogueTestKit } from '../../catalogue-postgres/support/persisted-catalogue-scenario';
import { requireResolved } from './persisted-dependency-scenario';
import { deepEqual } from '@revisium/schema-toolkit/lib';

export async function createPersistedReferenceDeletionKit() {
  const kit = await createPersistedCatalogueTestKit();

  const givenReferencedTarget = async (targetCycle = false) => {
    const product = await kit.givenProduct(
      getObjectSchema({
        link: { ...getStringSchema(), foreignKey: 'targets' },
        note: getStringSchema(),
      }),
      { link: 'a', note: 'Head' },
    );
    const location = async () => ({
      revisionId: (await product.readSnapshot()).draft.id,
      tableId: 'products',
    });
    const initial = await location();
    let targetSchema = getObjectSchema({ code: getStringSchema() });
    if (targetCycle) {
      targetSchema = getObjectSchema({
        code: getStringSchema(),
        back: { ...getStringSchema(), foreignKey: 'products' },
      });
    }
    await kit.draftApi.apiCreateTable({
      revisionId: initial.revisionId,
      tableId: 'targets',
      schema: targetSchema,
    });
    for (const rowId of ['a', 'b']) {
      const targetData: Record<string, string> = {
        code: rowId.toUpperCase(),
      };
      if (targetCycle) {
        targetData.back = 'product';
      }
      await kit.draftApi.apiCreateRow({
        revisionId: initial.revisionId,
        tableId: 'targets',
        rowId,
        data: targetData,
      });
    }
    const baseline = await product.readSnapshot();
    await kit.draftApi.apiCreateRevision({
      projectId: baseline.branch.projectId,
      branchName: baseline.branch.name,
    });
    const original = await product.readSnapshot();
    const source = original.head.tables.find(({ id }) => id === 'products');
    const targets = original.head.tables.find(({ id }) => id === 'targets');
    const sourceRow = source?.rows.find(({ id }) => id === 'product');
    const targetA = targets?.rows.find(({ id }) => id === 'a');
    if (!source || !targets || !sourceRow || !targetA) {
      throw new Error('Expected published reference and target identities.');
    }
    if (!deepEqual(sourceRow.data, { note: 'Head', link: 'a' })) {
      throw new Error('Expected the published source reference to target A.');
    }

    const reference = async (
      predicate: (entry: DraftChangesCatalogueEntry) => boolean,
    ): Promise<DraftChangeRef> => {
      const entry = (await product.catalogue()).entries.find(predicate);
      if (!entry) {
        throw new Error('Expected native deletion dependency reference.');
      }
      return entry.ref;
    };
    const targetDeletion = () =>
      reference(
        (entry) =>
          entry.kind === 'row' &&
          entry.classification === 'deleted' &&
          entry.target.kind === 'row' &&
          entry.target.rowCreatedId === targetA.createdId,
      );
    const sourceDeletion = () =>
      reference(
        (entry) =>
          entry.kind === 'row' &&
          entry.classification === 'deleted' &&
          entry.target.kind === 'row' &&
          entry.target.rowCreatedId === sourceRow.createdId,
      );
    const sourceRetarget = () =>
      reference(
        (entry) =>
          entry.kind === 'rowField' &&
          entry.target.kind === 'rowField' &&
          entry.target.rowCreatedId === sourceRow.createdId &&
          entry.path === '/link',
      );
    const resolve = async (
      operation: 'commit' | 'discard',
      selectedRef: DraftChangeRef,
    ) => {
      const snapshot = await product.readSnapshot();
      const catalogue = await product.catalogue();
      const selection = await kit.changes.resolveSelection({
        catalogue,
        selection: { include: [{ kind: 'change', ref: selectedRef }] },
      });
      if (selection.status !== 'resolved') {
        throw new Error('Expected the native deletion selection to resolve.');
      }
      return kit.changes.resolveCandidateDependencies({
        snapshot,
        catalogue,
        selection,
        operation,
        mode: 'selected',
      });
    };
    const deleteTarget = async () =>
      kit.draftApi.apiRemoveRow({
        revisionId: (await location()).revisionId,
        tableId: 'targets',
        rowId: 'a',
      });
    const deleteSource = async () =>
      kit.draftApi.apiRemoveRow({ ...(await location()), rowId: 'product' });

    return {
      readSnapshot: product.readSnapshot,
      tableCreatedId: source.createdId,
      rowCreatedId: sourceRow.createdId,
      retargetThenDelete: async () => {
        await kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: { link: 'b', note: 'Draft' },
        });
        await deleteTarget();
      },
      deleteSourceThenTarget: async () => {
        await deleteSource();
        await deleteTarget();
      },
      removeLinkThenDeleteSourceAndTarget: async () => {
        await kit.draftApi.apiUpdateTable({
          ...(await location()),
          patches: [{ op: 'remove', path: '/properties/link' }],
        });
        await deleteSource();
        await deleteTarget();
      },
      commitTargetDeletion: async () =>
        resolve('commit', await targetDeletion()),
      discardSourceRetarget: async () =>
        resolve('discard', await sourceRetarget()),
      requiredRetarget: async () => ({
        role: 'head' as const,
        kind: 'catalogueEffects' as const,
        causeRef: await targetDeletion(),
        refs: [await sourceRetarget()],
      }),
      requiredSourceDeletion: async () => ({
        role: 'head' as const,
        kind: 'catalogueEffects' as const,
        causeRef: await targetDeletion(),
        refs: [await sourceDeletion()],
      }),
      requiredTargetRestoration: async () => ({
        role: 'draft' as const,
        kind: 'catalogueEffects' as const,
        causeRef: await sourceRetarget(),
        refs: [await targetDeletion()],
      }),
    };
  };

  return {
    close: kit.close,
    givenReferencedTarget: () => givenReferencedTarget(),
    givenReferenceCycle: () => givenReferencedTarget(true),
  };
}

export function deletionRows(
  result: ResolveCandidateDependenciesResult,
  role: 'head' | 'draft',
  tableId: 'products' | 'targets',
) {
  const table = requireResolved(result)[role].tables.find(
    ({ id }) => id === tableId,
  );
  if (!table) {
    throw new Error('Expected deletion result table.');
  }
  return table.rows
    .map(({ id, data }) => ({ id, data }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
