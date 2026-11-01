import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  addField,
  replaceField,
  update,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const PRODUCTS = 'products';
const GOODS = 'goods';
const MISSING = 'missing';

const productSchema = obj({ code: str(), price: num() });

describe('ChangeCatalogue: ledger attribution', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('attributes to a table only its own pending migrations, not those of a table that used its id inside the Draft', async () => {
    const draft = await givenCommittedProducts();
    await draft.renameTable(PRODUCTS, GOODS);
    await draft.createTable(PRODUCTS, productSchema);
    await draft.updateTable(PRODUCTS, [replaceField('code', num())]);
    await draft.removeTable(PRODUCTS);
    await draft.updateRow(GOODS, 'p1', { code: 'edited', price: 1 });

    const catalogue = await draft.readCatalogue([GOODS]);

    expect(catalogue.units()).toEqual([
      { kind: 'structure', tableId: GOODS, previousTableId: PRODUCTS },
      { kind: 'field', tableId: GOODS, rowId: 'p1', path: '/code' },
    ]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  it('reports a pending migration that cannot be attributed to a table', async () => {
    const draft = await givenCommittedProducts();
    const unattributable = update(MISSING, [addField('code', str())]);
    await draft.recordPendingMigration(unattributable);

    const catalogue = await draft.readCatalogue([]);

    expect(catalogue.ledgerInconsistencies).toEqual([
      {
        reason: 'unattributableMigration',
        tableId: MISSING,
        migrationId: unattributable.id,
      },
    ]);
    expect(catalogue.units()).toEqual([]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  it('reports a table whose Draft schema history does not extend its Head history', async () => {
    const draft = await givenCommittedProducts();
    await draft.rewriteSchemaHistory(PRODUCTS, []);

    const catalogue = await draft.readCatalogue([PRODUCTS]);

    expect(catalogue.ledgerInconsistencies).toEqual([
      { reason: 'historyNotExtendingHead', tableId: PRODUCTS },
    ]);
    expect(catalogue.units()).toEqual([
      { kind: 'structure', tableId: PRODUCTS },
    ]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { code: 'one', price: 1 } },
      },
    });
  }
});
