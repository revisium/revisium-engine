import {
  getArraySchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { DraftChangesChoice } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import { createPersistedCatalogueTestKit } from '../../catalogue-postgres/support/persisted-catalogue-scenario';
import { requireResolved } from './persisted-dependency-scenario';
import { deepEqual } from '@revisium/schema-toolkit/lib';

export async function createPersistedReferenceSwapKit() {
  const kit = await createPersistedCatalogueTestKit();

  const givenReferenceSwap = async () => {
    const schema = getObjectSchema({
      refs: getArraySchema(
        getObjectSchema({
          link: { ...getStringSchema(), foreignKey: 'products' },
          note: getStringSchema(),
        }),
      ),
    });
    const product = await kit.givenProduct(schema, {
      refs: [{ link: 'product', note: 'Head' }],
    });
    const location = async () => ({
      revisionId: (await product.readSnapshot()).draft.id,
      tableId: 'products',
    });

    for (const rowId of ['a', 'b']) {
      await kit.draftApi.apiCreateRow({
        ...(await location()),
        rowId,
        data: { refs: [{ link: 'product', note: rowId }] },
      });
    }
    await kit.draftApi.apiUpdateRow({
      ...(await location()),
      rowId: 'product',
      data: { refs: [{ link: 'a', note: 'Head' }] },
    });
    const baseline = await product.readSnapshot();
    await kit.draftApi.apiCreateRevision({
      projectId: baseline.branch.projectId,
      branchName: baseline.branch.name,
    });
    const original = await product.readSnapshot();
    const originalTable = original.head.tables.find(
      ({ id }) => id === 'products',
    );
    const originalA = originalTable?.rows.find(({ id }) => id === 'a');
    const originalB = originalTable?.rows.find(({ id }) => id === 'b');
    const originalProduct = originalTable?.rows.find(
      ({ id }) => id === 'product',
    );
    if (!originalTable || !originalA || !originalB || !originalProduct) {
      throw new Error('Expected published stable row identities before swap.');
    }
    if (
      !deepEqual(originalProduct.data, { refs: [{ link: 'a', note: 'Head' }] })
    ) {
      throw new Error('Expected original Head binding to A before swap.');
    }

    for (const [rowId, nextRowId] of [
      ['a', 'swap-temp'],
      ['b', 'a'],
      ['swap-temp', 'b'],
    ] as const) {
      await kit.draftApi.apiRenameRow({
        ...(await location()),
        rowId,
        nextRowId,
      });
    }
    const renamed = await product.readSnapshot();
    const renamedProduct = renamed.draft.tables
      .find(({ createdId }) => createdId === originalTable.createdId)
      ?.rows.find(({ createdId }) => createdId === originalProduct.createdId);
    if (
      !deepEqual(renamedProduct?.data, { refs: [{ link: 'b', note: 'Head' }] })
    ) {
      throw new Error(
        'Native incoming FK rewrite did not follow original A through swap.',
      );
    }
    await kit.draftApi.apiUpdateRow({
      ...(await location()),
      rowId: 'product',
      data: { refs: [{ link: 'a', note: 'Draft' }] },
    });
    const terminal = await product.readSnapshot();
    const terminalTable = terminal.draft.tables.find(
      ({ createdId }) => createdId === originalTable.createdId,
    );
    if (
      !terminalTable ||
      terminalTable.rows.find(
        ({ createdId }) => createdId === originalA.createdId,
      )?.id !== 'b' ||
      terminalTable.rows.find(
        ({ createdId }) => createdId === originalB.createdId,
      )?.id !== 'a'
    ) {
      throw new Error('Native row swap did not preserve stable identities.');
    }
    if (
      !deepEqual(
        terminalTable.rows.find(
          ({ createdId }) => createdId === originalProduct.createdId,
        )?.data,
        { refs: [{ link: 'a', note: 'Draft' }] },
      )
    ) {
      throw new Error('Expected independent Draft retarget to original B.');
    }
    const sourceCatalogue = await product.catalogue();
    const sourceRename = sourceCatalogue.entries.find(
      (entry) =>
        entry.kind === 'row' &&
        entry.classification === 'renamed' &&
        entry.target.kind === 'row' &&
        entry.target.rowCreatedId === originalA.createdId,
    );
    if (!sourceRename) {
      throw new Error('Expected original A rename cause in native catalogue.');
    }

    const resolve = async (includeAtomicValue: boolean) => {
      const snapshot = await product.readSnapshot();
      const catalogue = await product.catalogue();
      const include: DraftChangesChoice[] = catalogue.entries
        .filter(
          ({ kind, classification }) =>
            kind === 'row' && classification === 'renamed',
        )
        .map(({ ref }) => ({ kind: 'change', ref }));
      if (includeAtomicValue) {
        include.push({
          kind: 'rowFields',
          tableId: 'products',
          rowId: 'product',
          paths: ['/refs'],
        });
      }
      const selection = await kit.changes.resolveSelection({
        catalogue,
        selection: { include },
      });
      if (selection.status !== 'resolved') {
        throw new Error(
          `Invalid swap fixture selection: ${JSON.stringify(selection)}`,
        );
      }
      return kit.changes.resolveCandidateDependencies({
        snapshot,
        operation: 'commit',
        mode: 'selected',
        catalogue,
        selection,
      });
    };

    return {
      commitRenames: () => resolve(false),
      commitRenamesAndAtomicValue: () => resolve(true),
      bindings: {
        tableCreatedId: originalTable.createdId,
        rowACreatedId: originalA.createdId,
        rowBCreatedId: originalB.createdId,
      },
      expectedAutomatic: {
        kind: 'rowForeignKey',
        role: 'head',
        tableCreatedId: originalTable.createdId,
        rowCreatedId: originalProduct.createdId,
        targetTableCreatedId: originalTable.createdId,
        targetRowCreatedId: originalA.createdId,
        path: '/refs/0/link',
        before: 'a',
        after: 'b',
        causeRefs: [sourceRename.ref],
      },
    };
  };

  return { close: kit.close, givenReferenceSwap };
}

export function productReferences(result: ResolveCandidateDependenciesResult) {
  const resolved = requireResolved(result);
  const read = (role: 'head' | 'draft') => {
    const row = resolved[role].tables
      .find(({ id }) => id === 'products')
      ?.rows.find(({ id }) => id === 'product');
    if (!row) {
      throw new Error('Expected swapped product reference row.');
    }
    return row.data;
  };
  return { head: read('head'), draft: read('draft') };
}

export function swappedRowIds(
  result: ResolveCandidateDependenciesResult,
  bindings: {
    tableCreatedId: string;
    rowACreatedId: string;
    rowBCreatedId: string;
  },
) {
  const resolved = requireResolved(result);
  const read = (role: 'head' | 'draft') => {
    const table = resolved[role].tables.find(
      ({ createdId }) => createdId === bindings.tableCreatedId,
    );
    if (!table) {
      throw new Error('Expected reference-swap result table.');
    }
    return {
      a: table.rows.find(
        ({ createdId }) => createdId === bindings.rowACreatedId,
      )?.id,
      b: table.rows.find(
        ({ createdId }) => createdId === bindings.rowBCreatedId,
      )?.id,
      temporary: table.rows.some(({ id }) => id === 'swap-temp'),
    };
  };
  return { head: read('head'), draft: read('draft') };
}
