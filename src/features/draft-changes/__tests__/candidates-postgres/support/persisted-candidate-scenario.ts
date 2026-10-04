import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { DraftChangesSelection } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { findStateRow } from './candidate-results';
export {
  productStates,
  restoredProductHash,
  restoredProductMetadata,
  restoredSchemaHistory,
  candidateSchemaHash,
  sourceSchemaHash,
  candidateTableRows,
  requireCalculated,
} from './candidate-results';
import { createPersistedCatalogueTestKit } from '../../catalogue-postgres/support/persisted-catalogue-scenario';

export async function createPersistedCandidateTestKit() {
  const kit = await createPersistedCatalogueTestKit();

  const givenProduct = async (
    schema?: JsonSchema,
    data?: Record<string, unknown>,
  ) => {
    const product = await kit.givenProduct(schema, data);

    const location = async () => ({
      revisionId: (await product.readSnapshot()).draft.id,
      tableId: 'products',
    });

    const calculate = async (
      operation: 'commit' | 'discard',
      selection: DraftChangesSelection,
    ) => {
      const snapshot = await product.readSnapshot();
      const catalogue = await product.catalogue();
      const resolved = await kit.changes.resolveSelection({
        catalogue,
        selection,
      });
      if (resolved.status !== 'resolved') {
        throw new Error(
          `Invalid candidate fixture selection: ${JSON.stringify(resolved)}`,
        );
      }
      return kit.changes.calculateDataCandidates({
        snapshot,
        operation,
        mode: 'selected',
        catalogue,
        selection: resolved,
      });
    };

    const tamperRowData = async (rowId: string, data: InputJsonValue) => {
      const row = findSnapshotRow(
        await product.readSnapshot(),
        'products',
        rowId,
      );
      await kit.prisma.row.update({
        where: { versionId: row.versionId },
        data: { data },
      });
    };

    const deletionReference = async (kind: 'table' | 'row') => {
      const entry = (await product.catalogue()).entries.find(
        (entry) => entry.kind === kind && entry.classification === 'deleted',
      );
      if (!entry) {
        throw new Error(`Expected native ${kind} deletion.`);
      }
      return entry.ref;
    };

    return {
      ...product,
      calculate,
      fieldReference: async (path: string) => {
        const entry = (await product.catalogue()).entries.find(
          (entry) => entry.kind === 'rowField' && entry.path === path,
        );
        if (!entry) {
          throw new Error(`Expected native field change '${path}'.`);
        }
        return entry.ref;
      },
      schemaRenameReference: async () => {
        const entry = (await product.catalogue()).entries.find(
          (entry) =>
            entry.kind === 'schemaField' && entry.classification === 'renamed',
        );
        if (!entry) {
          throw new Error('Expected native schema rename.');
        }
        return entry.ref;
      },
      renameTableAndCreateRow: async () => {
        const revisionId = (await product.readSnapshot()).draft.id;
        await kit.draftApi.apiRenameTable({
          revisionId,
          tableId: 'products',
          nextTableId: 'renamed-products',
        });
        await kit.draftApi.apiCreateRow({
          revisionId,
          tableId: 'renamed-products',
          rowId: 'new',
          data: { price: 0, title: 'New' },
        });
      },
      tableRenameReference: async () => {
        const entry = (await product.catalogue()).entries.find(
          (entry) =>
            entry.kind === 'table' && entry.classification === 'renamed',
        );
        if (!entry) {
          throw new Error('Expected native table rename.');
        }
        return entry.ref;
      },
      editRenamedPriceKeepingTitle: async () =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: { amount: 25, title: 'Draft' },
        }),
      editPriceDescription: async () =>
        kit.draftApi.apiUpdateTable({
          ...(await location()),
          patches: [
            {
              op: 'replace',
              path: '/properties/price',
              value: { ...getNumberSchema(), description: 'Draft' },
            },
          ],
        }),
      createPlainRow: async () =>
        kit.draftApi.apiCreateRow({
          ...(await location()),
          rowId: 'new',
          data: { price: 0, title: 'New' },
        }),
      changeNestedChildType: async () =>
        kit.draftApi.apiUpdateTable({
          ...(await location()),
          patches: [
            {
              op: 'replace',
              path: '/properties/oldParent/properties/child',
              value: getNumberSchema(),
            },
          ],
        }),
      editNestedChild: async (renamed: boolean) =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: {
            [renamed ? 'newParent' : 'oldParent']: { child: 7, sibling: 'S' },
          },
        }),
      deletedTableReference: () => deletionReference('table'),
      deletedRowReference: () => deletionReference('row'),
      headProductHash: async () =>
        findStateRow((await product.readSnapshot()).head, 'products', 'product')
          .hash,
      headSchemaHistory: async () =>
        findStateRow(
          (await product.readSnapshot()).head,
          SystemTables.Schema,
          'products',
        ).meta,
      editBothFields: async () =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: { price: 25, title: 'Draft' },
        }),
      deleteProduct: async () =>
        kit.draftApi.apiRemoveRow({
          ...(await location()),
          rowId: 'product',
        }),
      deleteTable: async () => kit.draftApi.apiRemoveTable(await location()),
      setExtraValue: async () =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: { price: 10, title: 'Head', extra: 7 },
        }),
      removePrice: async () =>
        kit.draftApi.apiUpdateTable({
          ...(await location()),
          patches: [{ op: 'remove', path: '/properties/price' }],
        }),
      invalidatePriceKeepingTitle: () =>
        tamperRowData('product', { price: 'invalid', title: 'Draft' }),
      omitNote: () => tamperRowData('product', { price: 10, title: 'Head' }),
      retainUnknownField: () =>
        tamperRowData('product', {
          price: 10,
          title: 'Head',
          extra: 0,
          rogue: 1,
        }),
      retainRenamedUnknownField: () =>
        tamperRowData('product', {
          newParent: { child: 'H', sibling: 'S', rogue: true },
        }),
      retainCollidingUnknownPrice: (price: number) =>
        tamperRowData('product', { amount: 10, title: 'Head', price }),
      retainEmptyObjectUnknownField: () =>
        tamperRowData('product', { newParent: { rogue: true } }),
      addArrayField: async () =>
        kit.draftApi.apiUpdateTable({
          ...(await location()),
          patches: [
            {
              op: 'add',
              path: '/properties/items/items/properties/extra',
              value: getNumberSchema(),
            },
          ],
        }),
      editArrayValues: async () =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: { items: [{ price: 25, extra: 7 }] },
        }),
      addObjectField: async () =>
        kit.draftApi.apiUpdateTable({
          ...(await location()),
          patches: [
            {
              op: 'add',
              path: '/properties/new',
              value: getObjectSchema({ x: getStringSchema() }),
            },
          ],
        }),
      editObjectChild: async () =>
        kit.draftApi.apiUpdateRow({
          ...(await location()),
          rowId: 'product',
          data: { price: 10, title: 'Head', new: { x: 'Value' } },
        }),
      editExtraDescription: async () =>
        kit.draftApi.apiUpdateTable({
          ...(await location()),
          patches: [
            {
              op: 'replace',
              path: '/properties/extra',
              value: { ...getNumberSchema(), description: 'Draft' },
            },
          ],
        }),
      addInvalidRow: async () => {
        await kit.draftApi.apiCreateRow({
          ...(await location()),
          rowId: 'invalid',
          data: { price: 0, title: '', extra: 0 },
        });
        await tamperRowData('invalid', {
          price: 'invalid',
          title: '',
          extra: 0,
        });
      },
      createExtraRow: async () =>
        kit.draftApi.apiCreateRow({
          ...(await location()),
          rowId: 'new',
          data: { price: 0, title: 'New', extra: 7 },
        }),
      createTableWithSiblingRows: async () => {
        const revisionId = (await product.readSnapshot()).draft.id;
        await kit.draftApi.apiCreateTable({
          revisionId,
          tableId: 'extras',
          schema: getObjectSchema({
            price: getNumberSchema(),
            title: getStringSchema(),
          }),
        });
        for (const rowId of ['selected', 'sibling']) {
          await kit.draftApi.apiCreateRow({
            revisionId,
            tableId: 'extras',
            rowId,
            data: { price: 0, title: rowId },
          });
        }
      },
      tamperProductHash: async () => {
        const row = findSnapshotRow(
          await product.readSnapshot(),
          'products',
          'product',
        );
        await kit.prisma.row.update({
          where: { versionId: row.versionId },
          data: { hash: 'stale-product-hash' },
        });
      },
      damageSchemaHistory: async () => {
        const row = findSnapshotRow(
          await product.readSnapshot(),
          SystemTables.Schema,
          'products',
        );
        await kit.prisma.row.update({
          where: { versionId: row.versionId },
          data: { meta: { damaged: true } },
        });
      },
      restoreHead: async () =>
        kit.changes.calculateDataCandidates({
          snapshot: await product.readSnapshot(),
          operation: 'discard',
          mode: 'restoreHead',
        }),
      calculateFields: (
        operation: 'commit' | 'discard',
        paths: string[],
        excluded: string[] = [],
      ) =>
        calculate(operation, {
          include: [
            { kind: 'rowFields', tableId: 'products', rowId: 'product', paths },
          ],
          exclude: [
            {
              kind: 'rowFields',
              tableId: 'products',
              rowId: 'product',
              paths: excluded,
            },
          ],
        }),
      calculateSchema: (operation: 'commit' | 'discard', paths: string[]) =>
        calculate(operation, {
          include: [{ kind: 'schemaFields', tableId: 'products', paths }],
        }),
    };
  };

  type ProductScenario = Awaited<ReturnType<typeof givenProduct>>;

  const draftLocation = async (product: ProductScenario) => ({
    revisionId: (await product.readSnapshot()).draft.id,
  });

  const createSecondaryHeadTable = async (product: ProductScenario) => {
    await kit.draftApi.apiCreateTable({
      ...(await draftLocation(product)),
      tableId: 'secondary-products',
      schema: getObjectSchema({ code: getStringSchema() }),
    });
    await kit.draftApi.apiCreateRow({
      ...(await draftLocation(product)),
      tableId: 'secondary-products',
      rowId: 'secondary',
      data: { code: 'Secondary' },
    });
    const snapshot = await product.readSnapshot();
    await kit.draftApi.apiCreateRevision({
      projectId: snapshot.branch.projectId,
      branchName: snapshot.branch.name,
    });
  };

  const changeProductSchemaAndData = async (product: ProductScenario) => {
    await kit.draftApi.apiUpdateTable({
      ...(await draftLocation(product)),
      tableId: 'products',
      patches: [
        { op: 'add', path: '/properties/extra', value: getNumberSchema() },
      ],
    });
    await kit.draftApi.apiUpdateRow({
      ...(await draftLocation(product)),
      tableId: 'products',
      rowId: 'product',
      data: { price: 25, title: 'Draft', extra: 7 },
    });
  };

  const swapTableNames = async (product: ProductScenario) => {
    for (const [tableId, nextTableId] of [
      ['products', 'swap-temp'],
      ['secondary-products', 'products'],
      ['swap-temp', 'secondary-products'],
    ] as const) {
      await kit.draftApi.apiRenameTable({
        ...(await draftLocation(product)),
        tableId,
        nextTableId,
      });
    }
  };

  const calculateTableRenames = async (
    product: ProductScenario,
    operation: 'commit' | 'discard',
  ) => {
    const catalogue = await product.catalogue();
    return product.calculate(operation, {
      include: catalogue.entries
        .filter(({ kind }) => kind === 'table')
        .map(({ ref }) => ({ kind: 'change', ref })),
    });
  };

  const givenTableSwap = async () => {
    const product = await givenProduct();
    await createSecondaryHeadTable(product);
    await changeProductSchemaAndData(product);
    await swapTableNames(product);
    return {
      original: await product.readSnapshot(),
      calculate: (operation: 'commit' | 'discard') =>
        calculateTableRenames(product, operation),
    };
  };

  const givenCreatedTableIdentityCollision = async () => {
    const product = await givenProduct();
    const revisionId = (await product.readSnapshot()).draft.id;
    await kit.draftApi.apiCreateTable({
      revisionId,
      tableId: 'new-products',
      schema: getObjectSchema({ value: getNumberSchema() }),
    });
    const table = (await product.readSnapshot()).draft.tables.find(
      ({ id }) => id === 'new-products',
    );
    if (!table) {
      throw new Error('Expected native new-products table.');
    }
    await kit.draftApi.apiCreateTable({
      revisionId,
      tableId: table.createdId,
      schema: getObjectSchema({ code: getStringSchema() }),
    });
    await kit.draftApi.apiCreateRow({
      revisionId,
      tableId: 'new-products',
      rowId: 'new',
      data: { value: 0 },
    });
    return {
      calculate: () =>
        product.calculate('commit', {
          include: [
            { kind: 'table', tableId: 'new-products', rows: 'all' },
            { kind: 'table', tableId: table.createdId, rows: 'none' },
          ],
        }),
    };
  };

  const givenOptionalProduct = () => {
    const schema = getObjectSchema({
      price: getNumberSchema(),
      title: getStringSchema(),
      note: { ...getStringSchema(), default: 'Default note' },
    });
    schema.required = ['price', 'title'];
    return givenProduct(schema, {
      price: 10,
      title: 'Head',
      note: 'Head note',
    });
  };

  const givenNestedProduct = () =>
    givenProduct(
      getObjectSchema({
        oldParent: getObjectSchema({
          child: getStringSchema(),
          sibling: getStringSchema(),
        }),
      }),
      { oldParent: { child: 'H', sibling: 'S' } },
    );

  const givenOptionalPriceProduct = () => {
    const schema = getObjectSchema({
      price: getNumberSchema(),
      title: getStringSchema(),
    });
    schema.required = ['title'];
    return givenProduct(schema, { price: 10, title: 'Head' });
  };

  const givenEmptyNestedProduct = () =>
    givenProduct(getObjectSchema({ oldParent: getObjectSchema({}) }), {
      oldParent: {},
    });

  return {
    close: kit.close,
    givenNestedProduct,
    givenOptionalPriceProduct,
    givenEmptyNestedProduct,
    givenProduct,
    givenTableSwap,
    givenCreatedTableIdentityCollision,
    givenOptionalProduct,
  };
}

function findSnapshotRow(
  snapshot: DraftChangesSnapshot,
  tableId: string,
  rowId: string,
) {
  return findStateRow(snapshot.draft, tableId, rowId);
}
