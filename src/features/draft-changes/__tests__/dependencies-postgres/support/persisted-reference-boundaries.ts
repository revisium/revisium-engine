import {
  getArraySchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { DraftChangesChoice } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { createPersistedCatalogueTestKit } from '../../catalogue-postgres/support/persisted-catalogue-scenario';
import { requireResolved } from './persisted-dependency-scenario';

export async function createPersistedReferenceBoundaryKit() {
  const kit = await createPersistedCatalogueTestKit();
  type Product = Awaited<ReturnType<typeof kit.givenProduct>>;

  const location = async (product: Product) => ({
    revisionId: (await product.readSnapshot()).draft.id,
    tableId: 'products',
  });

  const resolve = async (product: Product, include: DraftChangesChoice[]) => {
    const snapshot = await product.readSnapshot();
    const catalogue = await product.catalogue();
    const selection = await kit.changes.resolveSelection({
      catalogue,
      selection: { include },
    });
    if (selection.status !== 'resolved') {
      throw new Error(
        `Invalid boundary selection: ${JSON.stringify(selection)}`,
      );
    }
    return kit.changes.resolveCandidateDependencies({
      snapshot,
      catalogue,
      selection,
      operation: 'commit',
      mode: 'selected',
    });
  };

  const givenUnselectedRowRename = async () => {
    const product = await kit.givenProduct(
      getObjectSchema({
        link: { ...getStringSchema(), foreignKey: 'products' },
        note: getStringSchema(),
      }),
      { link: 'product', note: 'Head' },
    );
    const sourceCreatedId = originalProductId(await product.readSnapshot());
    await kit.draftApi.apiRenameRow({
      ...(await location(product)),
      rowId: 'product',
      nextRowId: 'renamed-product',
    });
    await kit.draftApi.apiUpdateRow({
      ...(await location(product)),
      rowId: 'renamed-product',
      data: { link: 'renamed-product', note: 'Draft' },
    });
    return {
      commitOnlyNote: () =>
        resolve(product, [
          {
            kind: 'rowFields',
            tableId: 'products',
            rowId: 'renamed-product',
            paths: ['/note'],
          },
        ]),
      rows: (result: ResolveCandidateDependenciesResult) =>
        productRows(result, sourceCreatedId),
    };
  };

  const givenDistinctArrayTargets = async () => {
    const product = await kit.givenProduct(
      getObjectSchema({
        links: getArraySchema(
          getObjectSchema({
            fk: { ...getStringSchema(), foreignKey: 'products' },
          }),
        ),
      }),
      { links: [{ fk: 'product' }] },
    );
    for (const rowId of ['a', 'x']) {
      await kit.draftApi.apiCreateRow({
        ...(await location(product)),
        rowId,
        data: { links: [{ fk: 'product' }] },
      });
    }
    await kit.draftApi.apiUpdateRow({
      ...(await location(product)),
      rowId: 'product',
      data: { links: [{ fk: 'a' }, { fk: 'x' }] },
    });
    const baseline = await product.readSnapshot();
    await kit.draftApi.apiCreateRevision({
      projectId: baseline.branch.projectId,
      branchName: baseline.branch.name,
    });
    const original = await product.readSnapshot();
    const sourceCreatedId = originalProductId(original);
    const table = original.head.tables.find(({ id }) => id === 'products');
    const target = table?.rows.find(({ id }) => id === 'a');
    if (!table || !target) {
      throw new Error('Expected published array targets before rename.');
    }
    await kit.draftApi.apiRenameRow({
      ...(await location(product)),
      rowId: 'a',
      nextRowId: 'b',
    });
    const rename = (await product.catalogue()).entries.find(
      (entry) =>
        entry.kind === 'row' &&
        entry.classification === 'renamed' &&
        entry.target.kind === 'row' &&
        entry.target.rowCreatedId === target.createdId,
    );
    if (!rename) {
      throw new Error('Expected native target rename reference.');
    }
    return {
      commitTargetRename: () =>
        resolve(product, [{ kind: 'change', ref: rename.ref }]),
      rows: (result: ResolveCandidateDependenciesResult) =>
        productRows(result, sourceCreatedId),
      automatic: {
        kind: 'rowForeignKey',
        role: 'head',
        tableCreatedId: table.createdId,
        rowCreatedId: sourceCreatedId,
        targetTableCreatedId: table.createdId,
        targetRowCreatedId: target.createdId,
        path: '/links/0/fk',
        before: 'a',
        after: 'b',
        causeRefs: [rename.ref],
      },
    };
  };

  return {
    close: kit.close,
    givenUnselectedRowRename,
    givenDistinctArrayTargets,
  };
}

function originalProductId(snapshot: DraftChangesSnapshot) {
  const row = snapshot.head.tables
    .find(({ id }) => id === 'products')
    ?.rows.find(({ id }) => id === 'product');
  if (!row) {
    throw new Error('Expected published product identity.');
  }
  return row.createdId;
}

function productRows(
  result: ResolveCandidateDependenciesResult,
  sourceCreatedId: string,
) {
  const resolved = requireResolved(result);
  const read = (role: 'head' | 'draft') => {
    const row = resolved[role].tables
      .find(({ id }) => id === 'products')
      ?.rows.find(({ createdId }) => createdId === sourceCreatedId);
    if (!row) {
      throw new Error('Expected product candidate identity.');
    }
    return { id: row.id, data: row.data };
  };
  return { head: read('head'), draft: read('draft') };
}
