import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  arr,
  num,
  numFormula,
  obj,
  ref,
  str,
} from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const POSTERS = 'posters';
const DOCUMENTS = 'documents';
const ORDERS = 'orders';

const posterSchema = obj({
  title: str(),
  size: obj({ width: num(), height: num() }),
  tags: arr(str()),
});
const documentSchema = obj({
  title: str(),
  image: ref(SystemSchemaIds.File),
});
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});

const emptyFile = {
  status: '',
  fileId: '',
  url: '',
  fileName: '',
  hash: '',
  extension: '',
  mimeType: '',
  size: 0,
  width: 0,
  height: 0,
};

describe('ChangeCatalogue: field units', () => {
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

  it('lists one field unit per edited leaf, a nested leaf at its pointer', async () => {
    const draft = await givenCommittedPoster();
    await draft.updateRow(POSTERS, 'p1', poster('renamed', 30, ['a', 'b']));

    const catalogue = await draft.readCatalogue([POSTERS]);

    expect(catalogue.unitsOf(POSTERS)).toEqual([
      { kind: 'field', tableId: POSTERS, rowId: 'p1', path: '/size/width' },
      { kind: 'field', tableId: POSTERS, rowId: 'p1', path: '/title' },
    ]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  it('lists an edited array as one field unit for the whole array', async () => {
    const draft = await givenCommittedPoster();
    await draft.updateRow(POSTERS, 'p1', poster('one', 10, ['a', 'c', 'd']));

    const catalogue = await draft.readCatalogue([POSTERS]);

    expect(catalogue.unitsOf(POSTERS)).toEqual([
      { kind: 'field', tableId: POSTERS, rowId: 'p1', path: '/tags' },
    ]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  it('lists an uploaded file as one field unit for the whole file value', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [DOCUMENTS]: {
        schema: documentSchema,
        rows: { d1: { title: 'one', image: emptyFile } },
      },
    });
    await draft.uploadFile(DOCUMENTS, 'd1', 'image');

    const catalogue = await draft.readCatalogue([DOCUMENTS]);

    expect(catalogue.unitsOf(DOCUMENTS)).toEqual([
      { kind: 'field', tableId: DOCUMENTS, rowId: 'd1', path: '/image' },
    ]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  it('lists no field unit for a formula output that follows an edited input', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [ORDERS]: {
        schema: orderSchema,
        rows: { o1: { price: 2, quantity: 3, total: 0 } },
      },
    });
    await draft.updateRow(ORDERS, 'o1', { price: 5, quantity: 3, total: 0 });

    const catalogue = await draft.readCatalogue([ORDERS]);

    expect(catalogue.unitsOf(ORDERS)).toEqual([
      { kind: 'field', tableId: ORDERS, rowId: 'o1', path: '/price' },
    ]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  it('lists only the edits of unchanged fields next to the structure unit when the structure changed', async () => {
    const draft = await givenCommittedPoster();
    await draft.updateTable(POSTERS, [addField('color', str())]);
    await draft.updateRow(POSTERS, 'p1', {
      ...poster('renamed', 10, ['a', 'b']),
      color: 'red',
    });

    const catalogue = await draft.readCatalogue([POSTERS]);

    expect(catalogue.unitsOf(POSTERS)).toEqual([
      { kind: 'structure', tableId: POSTERS },
      { kind: 'field', tableId: POSTERS, rowId: 'p1', path: '/title' },
    ]);
    expectEveryDifferenceOwnedOnce(catalogue);
  });

  function givenCommittedPoster(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [POSTERS]: {
        schema: posterSchema,
        rows: { p1: poster('one', 10, ['a', 'b']) },
      },
    });
  }
});

function poster(title: string, width: number, tags: string[]) {
  return { title, size: { width, height: 20 }, tags };
}
