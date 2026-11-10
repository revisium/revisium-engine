import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { replaceField } from 'src/__tests__/fixtures/ledger-steps';
import { countSqlStatements } from 'src/__tests__/utils/sql-statements';
import type { Sql } from 'src/engine-prisma-types';
import type {
  DraftFieldChange,
  DraftRowItem,
  IdExchange,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import { ChangeType } from 'src/features/revision-changes/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { readRowPageWhileDraftChanges } from '../../__tests__/support/draft-read-races';
import {
  rawQueriesDuring,
  rowItemsOf,
} from '../../__tests__/support/draft-reading';
import {
  fieldRef,
  headSideDeletionRef,
  renameRef,
} from '../../__tests__/support/expected-unit-refs';

const PRODUCTS = 'products';
const CODES = 'codes';
const OWNERS = 'owners';
const PETS = 'pets';
const PEOPLE = 'people';
const TOKENS = 'tokens';
const VETS = 'vets';
const VISITS = 'visits';
const FREE_CODE = 'free';
const DELETED_CODE = 'gone';
const PAGE_SIZES_OF_CHAINS = [{ first: 1 }, { first: 100 }];

const productSchema = obj({ title: str(), price: num() });
const visitSchema = obj({
  owner: str({ foreignKey: OWNERS }),
  vet: str({ foreignKey: VETS }),
});
const labelSchema = obj({ label: str() });
const ownerSchema = obj({ name: str() });
const petSchema = obj({
  name: str(),
  owner: str({ foreignKey: OWNERS }),
  sitters: arr(str({ foreignKey: OWNERS })),
});

describe('Draft row renames', () => {
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

  describe('id takeover', () => {
    it('links a deleted row and the rename that took over its id on both items, the deleted row first', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');

      const items = await readRowItems(draft);
      const takeover = {
        deletion: headSideDeletionRef(PRODUCTS, 'p1'),
        rename: renameRef(PRODUCTS, 'p1', 'p2'),
      };

      expect(
        items.map(({ changeType, idTakeover }) => [changeType, idTakeover]),
      ).toEqual([
        ['REMOVED', takeover],
        ['RENAMED', takeover],
      ]);
    });

    it('keeps the deleted row and the rename that took over its id on one page of one item, both linked', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');

      const page = await draft.readDraftRowChanges({ first: 1 });

      expect(page.edges.map(({ node }) => node.idTakeover)).toEqual([
        expect.any(Object),
        expect.any(Object),
      ]);
    });

    it('links no deletion and rename that do not share an id', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p20');

      const items = await readRowItems(draft);

      expect(items.map(({ idTakeover }) => idTakeover)).toEqual([
        undefined,
        undefined,
      ]);
    });
  });

  describe('id exchanges', () => {
    it('lists both renames of a swap on each of its items, its own rename first', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRowsAtOnce(PRODUCTS, [
        ['p1', 'p2'],
        ['p2', 'p1'],
      ]);

      const items = await readRowItems(draft);
      const p1FromP2 = renameRef(PRODUCTS, 'p1', 'p2');
      const p2FromP1 = renameRef(PRODUCTS, 'p2', 'p1');

      expect(idExchangesByRowId(items)).toEqual({
        p1: { renames: [p1FromP2, p2FromP1], termination: 'cycle' },
        p2: { renames: [p2FromP1, p1FromP2], termination: 'cycle' },
      });
    });

    it.each(PAGE_SIZES_OF_CHAINS)(
      'lists the renames of a 3-cycle in the order each takes the id of the next, on pages of $first',
      async ({ first }) => {
        const draft = await givenCommittedProducts();
        await draft.renameRowsAtOnce(PRODUCTS, [
          ['p1', 'p2'],
          ['p2', 'p3'],
          ['p3', 'p1'],
        ]);

        const items = rowItemsOf(await draft.readEveryDraftRowPage({ first }));
        const p1FromP3 = renameRef(PRODUCTS, 'p1', 'p3');
        const p2FromP1 = renameRef(PRODUCTS, 'p2', 'p1');
        const p3FromP2 = renameRef(PRODUCTS, 'p3', 'p2');

        expect(idExchangesByRowId(items)).toEqual({
          p1: {
            renames: [p1FromP3, p2FromP1, p3FromP2],
            termination: 'cycle',
          },
          p2: {
            renames: [p2FromP1, p3FromP2, p1FromP3],
            termination: 'cycle',
          },
          p3: {
            renames: [p3FromP2, p1FromP3, p2FromP1],
            termination: 'cycle',
          },
        });
      },
    );

    it.each(PAGE_SIZES_OF_CHAINS)(
      'lists a chain that ends in a free id on the rename that takes the id of another renamed row, on pages of $first',
      async ({ first }) => {
        const draft = await givenCommittedProducts();
        await draft.renameRow(PRODUCTS, 'p2', 'p9');
        await draft.renameRow(PRODUCTS, 'p1', 'p2');

        const page = await draft.readDraftRowChanges({ first });

        expect(page.edges[0]?.node.idExchange).toEqual({
          renames: [
            renameRef(PRODUCTS, 'p2', 'p1'),
            renameRef(PRODUCTS, 'p9', 'p2'),
          ],
          termination: 'freeId',
        });
      },
    );

    it.each(PAGE_SIZES_OF_CHAINS)(
      'lists a chain that ends in the id of a deleted row, on pages of $first, which links that row to the last rename',
      async ({ first }) => {
        const takeoverOfP3 = {
          deletion: headSideDeletionRef(PRODUCTS, 'p3'),
          rename: renameRef(PRODUCTS, 'p3', 'p2'),
        };
        const draft = await givenCommittedProducts();
        await draft.removeRow(PRODUCTS, 'p3');
        await draft.renameRow(PRODUCTS, 'p2', 'p3');
        await draft.renameRow(PRODUCTS, 'p1', 'p2');

        const items = rowItemsOf(await draft.readEveryDraftRowPage({ first }));

        expect(items[0]?.idExchange).toEqual({
          renames: [
            renameRef(PRODUCTS, 'p2', 'p1'),
            renameRef(PRODUCTS, 'p3', 'p2'),
          ],
          termination: 'deletedOccupant',
        });
        expect(
          items
            .filter(({ rowId }) => rowId === 'p3')
            .map(({ changeType, idTakeover }) => [changeType, idTakeover]),
        ).toEqual([
          ['REMOVED', takeoverOfP3],
          ['RENAMED', takeoverOfP3],
        ]);
      },
    );

    it.each([
      { chain: 49, listed: 49, termination: 'freeId' },
      { chain: 50, listed: 50, termination: 'freeId' },
      { chain: 51, listed: 50, termination: 'truncated' },
    ])(
      'lists $listed renames of a chain of $chain renames into a free id, read from a page that holds only its first, and says it ends $termination',
      async ({ chain, listed, termination }) => {
        const rowIds = chainRowIds(chain);
        const draft = await givenCommittedCodes(rowIds);
        await draft.renameEachRowIntoTheNext(CODES, rowIds, FREE_CODE);

        const page = await draft.readDraftRowChanges({ first: 1 });

        expect(page.edges[0]?.node.idExchange).toEqual({
          renames: renamesAlong([...rowIds, FREE_CODE]).slice(0, listed),
          termination,
        });
      },
    );

    it.each([
      { cycle: 50, listed: 50, termination: 'cycle' },
      { cycle: 51, listed: 50, termination: 'truncated' },
    ])(
      'lists $listed renames of a cycle of $cycle renames, read from a page that holds only its first, and says it ends $termination',
      async ({ cycle, listed, termination }) => {
        const rowIds = chainRowIds(cycle);
        const draft = await givenCommittedCodes(rowIds);
        await draft.renameRowsAtOnce(
          CODES,
          rowIds.map((rowId, index) => [
            rowId,
            rowIds[(index + 1) % rowIds.length] ?? rowId,
          ]),
        );

        const page = await draft.readDraftRowChanges({ first: 1 });

        expect(page.edges[0]?.node.idExchange).toEqual({
          renames: rowIds
            .slice(0, listed)
            .map((rowId, index) =>
              renameRef(CODES, rowId, rowIds.at(index - 1) ?? rowId),
            ),
          termination,
        });
      },
    );

    it('lists 50 renames of a chain of 50 renames into the id of a deleted row and says it ends in that row', async () => {
      const rowIds = chainRowIds(50);
      const draft = await givenCommittedCodes([...rowIds, DELETED_CODE]);
      await draft.removeRow(CODES, DELETED_CODE);
      await draft.renameEachRowIntoTheNext(CODES, rowIds, DELETED_CODE);

      const page = await draft.readDraftRowChanges({ first: 1 });

      expect(page.edges[0]?.node.idExchange).toEqual({
        renames: renamesAlong([...rowIds, DELETED_CODE]),
        termination: 'deletedOccupant',
      });
    });

    it('looks up the renames of a chain off the page in one statement, however long the chain', async () => {
      const overChainOf2 = await lookupsOfFirstPageOverChainOf(2);
      const overChainOf50 = await lookupsOfFirstPageOverChainOf(50);

      expect(overChainOf2.headIdLookups).toBe(1);
      expect(overChainOf50.headIdLookups).toBe(1);
      expect(overChainOf50.statements).toBe(overChainOf2.statements);
    });

    it('gives no id exchange to a rename into a free id or into the id of a deleted row', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRow(PRODUCTS, 'p1', 'p10');
      await draft.removeRow(PRODUCTS, 'p2');
      await draft.renameRow(PRODUCTS, 'p3', 'p2');

      const items = await readRowItems(draft);

      expect(items.map(({ idExchange }) => idExchange)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    });
  });

  describe('references rewritten by a rename', () => {
    it('says that a reference rewritten by the rename of its row follows that rename, also when the rename is on another page', async () => {
      const draft = await givenCommittedOwnersWithPets();
      await draft.renameRow(OWNERS, 'o2', 'o2x');

      const items = rowItemsOf(await draft.readEveryDraftRowPage({ first: 1 }));

      expect(
        items
          .filter(({ tableId }) => tableId === PETS)
          .map(({ rowId, fields }) => [
            rowId,
            fields.filter(({ path }) => path === '/owner'),
          ]),
      ).toEqual([
        ['pet2', [ownerFollowingTheRename('pet2')]],
        ['pet3', [ownerFollowingTheRename('pet3')]],
      ]);
    });

    it('says that a reference rewritten by a rename follows that rename when a filter leaves the rename out', async () => {
      const draft = await givenCommittedOwnersWithPets();
      await draft.renameRow(OWNERS, 'o2', 'o2x');

      const byTable = rowItemsOf([
        await draft.readDraftRowChanges({
          first: 100,
          filters: { tableId: PETS },
        }),
      ]);
      const byChangeType = rowItemsOf([
        await draft.readDraftRowChanges({
          first: 100,
          filters: { changeTypes: [ChangeType.Modified] },
        }),
      ]);

      for (const items of [byTable, byChangeType]) {
        expect(
          items.map(({ tableId, rowId, fields }) => [
            tableId,
            rowId,
            fields.filter(({ path }) => path === '/owner'),
          ]),
        ).toEqual([
          [PETS, 'pet2', [ownerFollowingTheRename('pet2')]],
          [PETS, 'pet3', [ownerFollowingTheRename('pet3')]],
        ]);
      }
    });

    it('says that an array element rewritten by a rename follows it, by position', async () => {
      const draft = await givenCommittedOwnersWithPets();
      await draft.renameRow(OWNERS, 'o1', 'o1x');

      const pet3 = await readPet(draft, 'pet3');

      expect(pet3.fields).toEqual([
        {
          path: '/sitters/1',
          changeType: 'FIELD_MODIFIED',
          oldValue: 'o1',
          newValue: 'o1x',
          selection: {
            state: 'unit',
            unit: fieldRef(PETS, 'pet3', '/sitters'),
          },
          follows: {
            unit: renameRef(OWNERS, 'o1x', 'o1'),
            reason: 'referenceRename',
          },
        },
      ]);
    });

    it('says that a reference follows the rename of a row whose table was renamed too, its Head and Draft ids naming one table', async () => {
      const draft = await givenCommittedOwnersWithPets();
      await draft.renameTable(OWNERS, PEOPLE);
      await draft.renameRow(PEOPLE, 'o2', 'o2x');

      const pet2 = await readPet(draft, 'pet2');

      expect(pet2.fields.map(({ path, follows }) => [path, follows])).toEqual([
        [
          '/owner',
          {
            unit: renameRef(PEOPLE, 'o2x', 'o2'),
            reason: 'referenceRename',
          },
        ],
      ]);
    });

    it.each([
      ['an unrelated row to the renamed one', 'pet1', 'o2x'],
      ['the renamed row to a row that was not renamed', 'pet2', 'o1'],
      ['the renamed row to a created one', 'pet2', 'o2y'],
    ])(
      'does not say that a reference edited from %s follows a rename',
      async (_edit, petId, ownerId) => {
        const draft = await givenCommittedOwnersWithPets();
        await draft.renameRow(OWNERS, 'o2', 'o2x');
        await draft.createRows(OWNERS, { o2y: { name: 'created' } });
        await draft.updateRow(PETS, petId, {
          ...committedPet(petId),
          owner: ownerId,
        });

        const item = await readPet(draft, petId);

        expect(item.fields.map(({ path, follows }) => [path, follows])).toEqual(
          [['/owner', undefined]],
        );
      },
    );

    it('says that a reference edited from the previous id to the new id follows the rename, whoever wrote it', async () => {
      const draft = await givenCommittedOwnersWithPets();
      await draft.updateRow(PETS, 'pet2', {
        ...committedPet('pet2'),
        owner: 'o1',
      });
      await draft.renameRow(OWNERS, 'o2', 'o2x');
      await draft.updateRow(PETS, 'pet2', {
        ...committedPet('pet2'),
        owner: 'o2x',
      });

      const item = await readPet(draft, 'pet2');

      expect(item.fields).toEqual([ownerFollowingTheRename('pet2')]);
    });

    it("finds the renames that a page's references follow with one statement per referenced table, however many references, and reads no other rename", async () => {
      const fewer = await lookupsOfVisitsPage(2);
      const more = await lookupsOfVisitsPage(12);

      expect(fewer).toEqual({
        renamedRowLookups: 2,
        headIdLookups: 0,
        readsUnrelatedRename: false,
        statements: expect.any(Number),
      });
      expect(more).toEqual(fewer);
    });

    it('says that a reference whose structure moved it to another table does not follow a rename there', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [OWNERS]: {
          schema: ownerSchema,
          rows: { o1: { name: 'one' }, o2: { name: 'two' } },
        },
        [PEOPLE]: {
          schema: ownerSchema,
          rows: { o1: { name: 'one' }, o2: { name: 'two' } },
        },
        [PETS]: { schema: petSchema, rows: { pet2: committedPet('pet2') } },
      });
      await draft.updateTable(PETS, [
        replaceField('owner', str({ foreignKey: PEOPLE })),
      ]);
      await draft.renameRow(PEOPLE, 'o2', 'o2x');

      const pet2 = await readPet(draft, 'pet2');

      expect(
        pet2.fields.map(({ path, newValue, follows }) => [
          path,
          newValue,
          follows,
        ]),
      ).toEqual([['/owner', 'o2x', undefined]]);
    });

    it('says that the whole value of a row whose schema is one foreign key follows a rename', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [OWNERS]: { schema: ownerSchema, rows: { o1: { name: 'one' } } },
        [TOKENS]: {
          schema: str({ foreignKey: OWNERS }),
          rows: { t1: 'o1' },
        },
      });
      await draft.renameRow(OWNERS, 'o1', 'o1x');

      const items = await readRowItems(draft);
      const token = items.find(({ tableId }) => tableId === TOKENS);

      expect(
        token?.fields.map(({ path, oldValue, newValue, follows }) => [
          path,
          oldValue,
          newValue,
          follows,
        ]),
      ).toEqual([
        [
          '',
          'o1',
          'o1x',
          { unit: renameRef(OWNERS, 'o1x', 'o1'), reason: 'referenceRename' },
        ],
      ]);
    });

    function ownerFollowingTheRename(petId: string): DraftFieldChange {
      return {
        path: '/owner',
        changeType: 'FIELD_MODIFIED',
        oldValue: 'o2',
        newValue: 'o2x',
        selection: { state: 'unit', unit: fieldRef(PETS, petId, '/owner') },
        follows: {
          unit: renameRef(OWNERS, 'o2x', 'o2'),
          reason: 'referenceRename',
        },
      } as DraftFieldChange;
    }
  });

  describe('refused tables', () => {
    it('gives the rows of a project without a migration table no id takeover, id exchange or followed rename', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [OWNERS]: {
          schema: ownerSchema,
          rows: { o1: { name: 'one' }, o2: { name: 'two' } },
        },
        [PETS]: {
          schema: petSchema,
          rows: { pet1: committedPet('pet1') },
        },
        [PRODUCTS]: {
          schema: productSchema,
          rows: { p1: product('p1'), p2: product('p2'), p3: product('p3') },
        },
      });
      await draft.renameRow(OWNERS, 'o1', 'o1x');
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.renameRow(PRODUCTS, 'p2', 'p1');
      await draft.renameRow(PRODUCTS, 'p3', 'p2');

      const items = await readRowItems(draft);

      expect(items.length).toBeGreaterThan(0);
      expect(
        items.flatMap((item) => [
          ...(item.idTakeover ? [`${item.rowId} takeover`] : []),
          ...(item.idExchange ? [`${item.rowId} exchange`] : []),
          ...item.fields.flatMap(({ follows }) =>
            follows ? [`${item.rowId} follows`] : [],
          ),
        ]),
      ).toEqual([]);
      expect(
        items.every(({ selection }) => selection.state === 'refused'),
      ).toBe(true);
    });
  });

  describe('snapshot', () => {
    it('describes the snapshot of the chain it looks up off the page when the Draft changes before it reads its rows', async () => {
      const draft = await givenCommittedProducts();
      await draft.renameRow(PRODUCTS, 'p3', 'p4');
      await draft.renameRow(PRODUCTS, 'p2', 'p3');
      const before = await draft.readDraftRowChanges({ first: 1 });

      const page = await readRowPageWhileDraftChanges(
        kit,
        () => draft.readDraftRowChanges({ first: 1 }),
        () => draft.renameRow(PRODUCTS, 'p4', 'p5'),
      );

      expect(before.edges[0]?.node.idExchange?.termination).toBe('freeId');
      expect(page).toEqual(before);
      expect(await draft.readDraftRowChanges({ first: 1 })).not.toEqual(before);
    });

    it('describes the snapshot of the renames its references follow when the Draft changes before it reads their rows', async () => {
      const draft = await givenCommittedOwnersWithPets();
      await draft.renameRow(OWNERS, 'o2', 'o2x');
      const owners = await draft.readDraftRowChanges({ first: 1 });
      const readPets = () =>
        draft.readDraftRowChanges({
          first: 10,
          after: owners.pageInfo.endCursor,
        });
      const before = await readPets();

      const page = await readRowPageWhileDraftChanges(kit, readPets, () =>
        draft.renameRow(OWNERS, 'o2x', 'o2y'),
      );

      expect(
        rowItemsOf([before]).map(({ rowId, fields }) => [
          rowId,
          fields.find(({ path }) => path === '/owner')?.follows?.unit,
        ]),
      ).toEqual([
        ['pet2', renameRef(OWNERS, 'o2x', 'o2')],
        ['pet3', renameRef(OWNERS, 'o2x', 'o2')],
      ]);
      expect(page).toEqual(before);
      expect(await readPets()).not.toEqual(before);
    });
  });

  async function readRowItems(draft: ChangesScenario): Promise<DraftRowItem[]> {
    return rowItemsOf([await draft.readDraftRowChanges({ first: 100 })]);
  }

  async function readPet(
    draft: ChangesScenario,
    petId: string,
  ): Promise<DraftRowItem> {
    const item = (await readRowItems(draft)).find(
      ({ tableId, rowId }) => tableId === PETS && rowId === petId,
    );

    if (!item) {
      throw new Error(`No row item of ${petId}`);
    }

    return item;
  }

  async function lookupsOfFirstPageOverChainOf(
    chain: number,
  ): Promise<{ headIdLookups: number; statements: number }> {
    const rowIds = chainRowIds(chain);
    const draft = await givenCommittedCodes(rowIds);
    await draft.renameEachRowIntoTheNext(CODES, rowIds, FREE_CODE);
    const read = () => draft.readDraftRowChanges({ first: 1 });
    const { queries } = await rawQueriesDuring(kit, read);

    return {
      headIdLookups: queries.filter(isHeadIdLookup).length,
      statements: await countSqlStatements(read),
    };
  }

  // Visits that reference three owners and three vets, each renamed. One visit is edited from o1 to the new id of
  // another renamed owner, o9x, so the lookup finds that rename but no reference follows it. The owners and vets come
  // first, so a page of visits looks up the renames its references follow.
  async function lookupsOfVisitsPage(visits: number) {
    const ownerIds = ['o1', 'o2', 'o3'];
    const vetIds = ['v1', 'v2', 'v3'];
    const visitIds = Array.from({ length: visits }, (_, index) => `x${index}`);
    const draft = await ChangesScenario.committed(kit, {
      [OWNERS]: {
        schema: ownerSchema,
        rows: Object.fromEntries(
          [...ownerIds, 'o9'].map((id) => [id, { name: id }]),
        ),
      },
      [VETS]: {
        schema: ownerSchema,
        rows: Object.fromEntries(vetIds.map((id) => [id, { name: id }])),
      },
      [VISITS]: {
        schema: visitSchema,
        rows: Object.fromEntries(
          visitIds.map((id, index) => [
            id,
            {
              owner: ownerIds[index % ownerIds.length] ?? 'o1',
              vet: vetIds[index % vetIds.length] ?? 'v1',
            },
          ]),
        ),
      },
    });

    for (const ownerId of [...ownerIds, 'o9']) {
      await draft.renameRow(OWNERS, ownerId, `${ownerId}x`);
    }

    for (const vetId of vetIds) {
      await draft.renameRow(VETS, vetId, `${vetId}x`);
    }

    await draft.updateRow(VISITS, 'x0', { owner: 'o9x', vet: 'v1x' });

    const before = await draft.readDraftRowChanges({ first: 7 });
    const unrelated = await draft.row('draft', OWNERS, 'o9x');
    const read = () =>
      draft.readDraftRowChanges({
        first: 100,
        after: before.pageInfo.endCursor,
      });
    const { result, queries } = await rawQueriesDuring(kit, read);

    expect(
      rowItemsOf([result]).every(({ tableId }) => tableId === VISITS),
    ).toBe(true);

    return {
      renamedRowLookups: queries.filter(isRenamedRowLookup).length,
      headIdLookups: queries.filter(isHeadIdLookup).length,
      readsUnrelatedRename: queries.some(({ values }) =>
        values.flat().includes(unrelated.versionId),
      ),
      statements: await countSqlStatements(read),
    };
  }

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: product('p1'), p2: product('p2'), p3: product('p3') },
      },
    });
  }

  function givenCommittedCodes(
    rowIds: readonly string[],
  ): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CODES]: {
        schema: labelSchema,
        rows: Object.fromEntries(
          rowIds.map((rowId) => [rowId, { label: rowId }]),
        ),
      },
    });
  }

  function givenCommittedOwnersWithPets(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [OWNERS]: {
        schema: ownerSchema,
        rows: { o1: { name: 'one' }, o2: { name: 'two' } },
      },
      [PETS]: {
        schema: petSchema,
        rows: {
          pet1: committedPet('pet1'),
          pet2: committedPet('pet2'),
          pet3: committedPet('pet3'),
        },
      },
    });
  }
});

// pet1 belongs to o1, pet2 and pet3 to o2; pet3 is also looked after by o2 and o1, in that order.
function committedPet(petId: string) {
  const pets: Record<string, { owner: string; sitters: string[] }> = {
    pet1: { owner: 'o1', sitters: [] },
    pet2: { owner: 'o2', sitters: [] },
    pet3: { owner: 'o2', sitters: ['o2', 'o1'] },
  };
  const pet = pets[petId] ?? { owner: 'o1', sitters: [] };

  return { name: petId, ...pet };
}

function isRenamedRowLookup({ sql }: Sql): boolean {
  return sql.includes('WHERE d."id" = ANY(');
}

function isHeadIdLookup({ sql }: Sql): boolean {
  return sql.includes('WITH RECURSIVE walked');
}

function product(title: string) {
  return { title, price: 1 };
}

function chainRowIds(length: number): string[] {
  return Array.from(
    { length },
    (_, index) => `c${String(index + 1).padStart(2, '0')}`,
  );
}

// Each row of the chain takes the Head id of the next.
function renamesAlong(rowIds: readonly string[]): UnitRef[] {
  return rowIds
    .slice(1)
    .map((rowId, index) => renameRef(CODES, rowId, rowIds[index] ?? ''));
}

function idExchangesByRowId(
  items: readonly DraftRowItem[],
): Record<string, IdExchange> {
  return Object.fromEntries(
    items.flatMap(({ rowId, idExchange }) =>
      idExchange ? [[rowId, idExchange]] : [],
    ),
  );
}
