import { BadRequestException } from '@nestjs/common';
import { arr, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import type {
  JsonObjectSchema,
  JsonSchema,
} from '@revisium/schema-toolkit/types';
import { givenActiveMigration } from 'src/__tests__/fixtures/active-migration';
import { branchContentsOf } from 'src/__tests__/fixtures/branch-content';
import {
  BranchScenario,
  type TableFixture,
} from 'src/__tests__/fixtures/branch-scenario';
import { expectStrictlyAscending } from 'src/__tests__/fixtures/stored-ledger';
import { addField, removeField } from 'src/__tests__/fixtures/ledger-steps';
import {
  type BranchScenarioTestKit,
  createBranchScenarioTestKit,
} from 'src/__tests__/kit/create-branch-scenario-test-kit';
import type {
  BackfillRefusalCode,
  SchemaLedgerBackfill,
} from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  atClock,
  type BackfillInput,
  backfillLedger,
  commitHeadSchema,
  entriesOf,
  initEntry,
  linkDraftMigrationTable,
  planBackfill,
  renameHeadTableBelowNativeValidation,
  revisionsOf,
  transactionsStartedDuring,
  updateEntry,
  withoutIds,
} from './support/ledger-backfill';
import { removeSchemaRow, transactionModesDuring } from './support/ledger-scan';
import {
  CATEGORIES,
  categories,
  categorySchema,
  givenCommittedCatalog,
  PRODUCTS,
  products,
  productSchema,
  TAGS,
  tagSchema,
} from './support/ledger-damage';

const READ_ONLY_REPEATABLE_READ = {
  readOnly: 'on',
  isolation: 'repeatable read',
};

const ZONES = 'zones';
const ADDRESSES = 'addresses';
const ROUTES = 'routes';
const NODES = 'nodes';
const AUTHORS = 'authors';
const BOOKS = 'books';
const GOODS = 'goods';
const BAD_ID = 'bad id';

const zoneSchema = obj({ name: str() });
const addressSchema = obj({ place: obj({ zone: str({ foreignKey: ZONES }) }) });
const routeSchema = obj({ stops: arr(str({ foreignKey: ZONES })) });
const nodeSchema = obj({ name: str(), parent: str({ foreignKey: NODES }) });
const authorSchema = obj({ name: str() });
const bookSchema = obj({ author: str({ foreignKey: AUTHORS }), title: str() });
const authorWithFavouriteSchema = obj({
  favourite: str({ foreignKey: BOOKS }),
  name: str(),
});

interface CycleCase {
  readonly references: string;
  readonly given: () => Promise<BranchScenario>;
  readonly entries: string[];
}

interface SplitChoiceCase {
  readonly schema: string;
  readonly a: JsonSchema;
}

interface DraftStructureCase {
  readonly change: string;
  readonly given: (draft: BranchScenario) => Promise<void>;
  readonly tableIds: string[];
}

interface UnreproducibleCase {
  readonly schema: string;
  readonly given: (draft: BranchScenario) => Promise<void>;
  readonly tableId?: string;
  readonly reason: string;
}

interface InvalidInputCase {
  readonly input: BackfillInput;
  readonly message: string;
}

describe('Schema ledger backfill planning', () => {
  let kit: BranchScenarioTestKit;

  beforeAll(async () => {
    kit = await createBranchScenarioTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('the planned ledger', () => {
    it('plans an init of every Head table with its Head schema, a referenced table first, under ascending ids', async () => {
      const draft = await givenCatalogWithoutLedger();

      const backfill = await planBackfill(kit, draft);

      expect(backfill).toEqual({
        status: 'planned',
        ...(await revisionsOf(draft)),
        entries: [
          initEntry(CATEGORIES, categorySchema),
          initEntry(PRODUCTS, productSchema),
        ],
      });
      expectStrictlyAscending(entriesOf(backfill).map(({ id }) => id));
    });

    it('orders a table referenced from a nested object or an array before its referrers', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {
        [ZONES]: { schema: zoneSchema },
        [ADDRESSES]: { schema: addressSchema },
        [ROUTES]: { schema: routeSchema },
      });

      const backfill = await planBackfill(kit, draft);

      expect(entriesOf(backfill)).toEqual([
        initEntry(ZONES, zoneSchema),
        initEntry(ADDRESSES, addressSchema),
        initEntry(ROUTES, routeSchema),
      ]);
    });

    it('plans a self-reference within the init', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {
        [NODES]: { schema: nodeSchema },
      });

      const backfill = await planBackfill(kit, draft);

      expect(entriesOf(backfill)).toEqual([initEntry(NODES, nodeSchema)]);
    });

    it('splits a cycle of two tables at the smaller id: an init without the foreign key, then an update that restores it', async () => {
      const draft = await givenAuthorsAndBooksReferencingEachOther();

      const backfill = await planBackfill(kit, draft);

      expect(entriesOf(backfill)).toEqual([
        initEntry(AUTHORS, obj({ favourite: str(), name: str() })),
        initEntry(BOOKS, bookSchema),
        updateEntry(AUTHORS, authorWithFavouriteSchema),
      ]);
      expectStrictlyAscending(entriesOf(backfill).map(({ id }) => id));
    });

    it.each<CycleCase>([
      {
        references: 'a → b, b → c, c → a',
        given: givenThreeTableCycle,
        entries: ['init a', 'init c', 'init b', 'update a'],
      },
      {
        references: 'a → b, b → a, b → c, c → b',
        given: givenOverlappingCycles,
        entries: ['init a', 'init b', 'init c', 'update a', 'update b'],
      },
      {
        references: 'a → b, b → a, a → z',
        given: givenCycleMemberWithOrdinaryReference,
        entries: ['init z', 'init a', 'init b', 'update a'],
      },
      {
        references: 'a → c, c → d, d → c',
        given: givenTableReferencingCycle,
        entries: ['init c', 'init a', 'init d', 'update c'],
      },
    ])('plans $references as $entries', async ({ given, entries }) => {
      const draft = await given();

      const backfill = await planBackfill(kit, draft);

      expect(describedEntriesOf(backfill)).toEqual(entries);
    });

    it('strips from a split table only the foreign keys to tables not emitted yet', async () => {
      const draft = await givenCycleMemberWithOrdinaryReference();

      const backfill = await planBackfill(kit, draft);

      expect(entriesOf(backfill)).toEqual([
        initEntry('z', letterSchema()),
        initEntry('a', letterSchema({ b: str(), z: str({ foreignKey: 'z' }) })),
        initEntry('b', letterSchema({ a: str({ foreignKey: 'a' }) })),
        updateEntry(
          'a',
          letterSchema({
            b: str({ foreignKey: 'b' }),
            z: str({ foreignKey: 'z' }),
          }),
        ),
      ]);
    });

    it('splits each of two overlapping cycles at the table with the smaller id', async () => {
      const draft = await givenOverlappingCycles();

      const backfill = await planBackfill(kit, draft);

      expect(entriesOf(backfill)).toEqual([
        initEntry('a', letterSchema({ b: str() })),
        initEntry('b', letterSchema({ a: str({ foreignKey: 'a' }), c: str() })),
        initEntry('c', letterSchema({ b: str({ foreignKey: 'b' }) })),
        updateEntry('a', letterSchema({ b: str({ foreignKey: 'b' }) })),
        updateEntry(
          'b',
          letterSchema({
            a: str({ foreignKey: 'a' }),
            c: str({ foreignKey: 'c' }),
          }),
        ),
      ]);
    });

    it('keeps a self-reference in the init of a split table', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {
        [AUTHORS]: { schema: authorSchema },
        [BOOKS]: { schema: bookSchema },
      });
      await draft.updateTable(AUTHORS, [
        addField('favourite', str({ foreignKey: BOOKS })),
        addField('mentor', str({ foreignKey: AUTHORS })),
      ]);
      await draft.commit();

      const backfill = await planBackfill(kit, draft);

      expect(entriesOf(backfill)).toEqual([
        initEntry(
          AUTHORS,
          obj({
            favourite: str(),
            mentor: str({ foreignKey: AUTHORS }),
            name: str(),
          }),
        ),
        initEntry(BOOKS, bookSchema),
        updateEntry(
          AUTHORS,
          obj({
            favourite: str({ foreignKey: BOOKS }),
            mentor: str({ foreignKey: AUTHORS }),
            name: str(),
          }),
        ),
      ]);
    });

    it('strips a foreign key inside an array or a nested object of a split table', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {
        [AUTHORS]: { schema: authorSchema },
        [BOOKS]: { schema: bookSchema },
      });
      await draft.updateTable(AUTHORS, [
        addField('favourites', arr(str({ foreignKey: BOOKS }))),
        addField('profile', obj({ book: str({ foreignKey: BOOKS }) })),
      ]);
      await draft.commit();

      const backfill = await planBackfill(kit, draft);

      expect(entriesOf(backfill)).toEqual([
        initEntry(
          AUTHORS,
          obj({
            favourites: arr(str()),
            name: str(),
            profile: obj({ book: str() }),
          }),
        ),
        initEntry(BOOKS, bookSchema),
        updateEntry(
          AUTHORS,
          obj({
            favourites: arr(str({ foreignKey: BOOKS })),
            name: str(),
            profile: obj({ book: str({ foreignKey: BOOKS }) }),
          }),
        ),
      ]);
    });

    it('plans an empty ledger for a Head without user tables', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {});

      const backfill = await planBackfill(kit, draft);

      expect(backfill).toEqual({
        status: 'planned',
        ...(await revisionsOf(draft)),
        entries: [],
      });
    });

    it('plans over Draft row changes in one read-only transaction and writes nothing', async () => {
      const draft = await givenCatalogWithoutLedger();
      await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });
      await draft.removeRow(PRODUCTS, 'p2');
      const before = await branchContentsOf(kit, draft);
      const backfills: SchemaLedgerBackfill[] = [];

      const modes = await transactionModesDuring(kit, async () => {
        backfills.push(await planBackfill(kit, draft));
      });

      expect(backfills.map(entriesOf)).toEqual([
        [
          initEntry(CATEGORIES, categorySchema),
          initEntry(PRODUCTS, productSchema),
        ],
      ]);
      expect(modes).toEqual([READ_ONLY_REPEATABLE_READ]);
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('plans the same entries again on a later dry run, under ids from the clock of that run', async () => {
      const draft = await givenCatalogWithoutLedger();
      const first = await planBackfill(kit, draft);

      const second = await atClock('2031-05-01T00:00:00.000Z', () =>
        planBackfill(kit, draft),
      );

      expect(withoutIds(entriesOf(second))).toEqual(
        withoutIds(entriesOf(first)),
      );
      expect(entriesOf(second).map(({ id }) => id)).toEqual([
        '2031-05-01T00:00:00.000Z',
        '2031-05-01T00:00:00.001Z',
      ]);
    });

    it('orders tables without references by code point, an upper-case id first', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {
        a: { schema: letterSchema() },
        B: { schema: letterSchema() },
      });

      const backfill = await planBackfill(kit, draft);

      expect(describedEntriesOf(backfill)).toEqual(['init B', 'init a']);
    });
  });

  describe('which table of a cycle is split', () => {
    it.each<SplitChoiceCase>([
      {
        schema: 'a non-empty default',
        a: letterSchema({
          b: str({ foreignKey: 'b' }),
          name: str({ default: 'x' }),
        }),
      },
      {
        schema: '`required` out of order',
        a: {
          ...letterSchema({ b: str({ foreignKey: 'b' }) }),
          required: ['name', 'b'],
        },
      },
    ])(
      'splits b when the Head schema of a has $schema, which the split would not keep',
      async ({ a }) => {
        const draft = await givenCycleWithNativelyUpdatedB(a);

        const backfill = await planBackfill(kit, draft);

        expect(entriesOf(backfill)).toEqual([
          initEntry('b', letterSchema({ a: str() })),
          initEntry('a', a),
          updateEntry('b', letterSchema({ a: str({ foreignKey: 'a' }) })),
        ]);
      },
    );

    it('refuses a cycle that no table of it survives, naming its tables but not a table that only references it', async () => {
      const draft = await givenCycleWithoutSurvivor();
      const before = await branchContentsOf(kit, draft);

      const backfill = await planBackfill(kit, draft);

      expect(backfill).toEqual({
        status: 'refused',
        ...(await revisionsOf(draft)),
        refusal: {
          code: 'schemaNotReproducible',
          tableIds: ['a', 'b'],
          message:
            'No table of the foreign-key cycles of "a", "b" keeps its Head schema when split; ' +
            'update one table of each cycle natively (which resets its field defaults) ' +
            'or remove one foreign key of each cycle, commit, then run again',
        },
      });
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('splits the other tables of two cycles through a table that does not survive', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {
        b: { schema: letterSchema() },
        c: { schema: letterSchema() },
        a: {
          schema: letterSchema({
            b: str({ foreignKey: 'b' }),
            c: str({ foreignKey: 'c' }),
            name: str({ default: 'x' }),
          }),
        },
      });
      await draft.updateTable('b', [addField('a', str({ foreignKey: 'a' }))]);
      await draft.updateTable('c', [addField('a', str({ foreignKey: 'a' }))]);
      await draft.commit();

      const backfill = await planBackfill(kit, draft);

      expect(describedEntriesOf(backfill)).toEqual([
        'init b',
        'init c',
        'init a',
        'update b',
        'update c',
      ]);
    });

    it('splits a cycle that survives and refuses naming only the cycle that does not', async () => {
      const draft = await BranchScenario.committedWithoutLedger(kit, {
        b: { schema: letterSchema({ name: str({ default: 'y' }) }) },
        a: {
          schema: letterSchema({
            b: str({ foreignKey: 'b' }),
            name: str({ default: 'x' }),
          }),
        },
        d: { schema: letterSchema() },
        c: { schema: letterSchema({ d: str({ foreignKey: 'd' }) }) },
      });
      await draft.updateTable('d', [addField('c', str({ foreignKey: 'c' }))]);
      await commitHeadSchema(
        kit,
        draft,
        'b',
        letterSchema({
          a: str({ foreignKey: 'a' }),
          name: str({ default: 'y' }),
        }),
      );

      const backfill = await planBackfill(kit, draft);

      expect(backfill).toEqual(
        await refusedWith(draft, 'schemaNotReproducible', ['a', 'b']),
      );
    });

    it('plans the cycle once a native update has normalised one of its tables', async () => {
      const draft = await givenCycleWithoutSurvivor();
      await draft.updateTable('a', [addField('note', str())]);
      await draft.commit();

      const backfill = await planBackfill(kit, draft);

      expect(describedEntriesOf(backfill)).toEqual([
        'init a',
        'init b',
        'init r',
        'update a',
      ]);
    });
  });

  describe('refusals', () => {
    it.each<DraftStructureCase>([
      {
        change: 'creates a table',
        given: (draft) => draft.createTable(TAGS, tagSchema),
        tableIds: [TAGS],
      },
      {
        change: 'removes a table',
        given: (draft) => draft.removeTable(PRODUCTS),
        tableIds: [PRODUCTS],
      },
      {
        change: 'renames a table',
        given: (draft) => draft.renameTable(PRODUCTS, GOODS),
        tableIds: [GOODS],
      },
      {
        change: 'removes a table and creates another under its id',
        given: async (draft) => {
          await draft.removeTable(PRODUCTS);
          await draft.createTable(PRODUCTS, productSchema);
        },
        tableIds: [PRODUCTS],
      },
      {
        change: 'changes a schema',
        given: (draft) =>
          draft.updateTable(CATEGORIES, [addField('note', str())]),
        tableIds: [CATEGORIES],
      },
      {
        change: 'changes a schema and changes it back',
        given: async (draft) => {
          await draft.updateTable(CATEGORIES, [addField('note', str())]);
          await draft.updateTable(CATEGORIES, [removeField('note')]);
        },
        tableIds: [CATEGORIES],
      },
      {
        change: 'links a migration table',
        given: (draft) => linkDraftMigrationTable(kit, draft),
        tableIds: [SystemTables.Migration],
      },
    ])(
      'refuses a Draft that $change and writes nothing',
      async ({ given, tableIds }) => {
        const draft = await givenCatalogWithoutLedger();
        await given(draft);
        const before = await branchContentsOf(kit, draft);

        const backfill = await planBackfill(kit, draft);

        expect(backfill).toEqual(
          await refusedWith(draft, 'draftStructureChanged', tableIds),
        );
        expect(await branchContentsOf(kit, draft)).toEqual(before);
      },
    );

    it('says what the Draft changes and what to do', async () => {
      const draft = await givenCatalogWithoutLedger();
      await draft.createTable(TAGS, tagSchema);
      await draft.removeTable(PRODUCTS);

      const backfill = await planBackfill(kit, draft);

      expect(backfill).toEqual({
        status: 'refused',
        ...(await revisionsOf(draft)),
        refusal: {
          code: 'draftStructureChanged',
          tableIds: [PRODUCTS, TAGS],
          message:
            'The Draft changes the structure of "products", "tags" without a ledger; ' +
            'commit or revert those changes natively, then run again',
        },
      });
    });

    it('says that only a revert removes a Draft migration table', async () => {
      const draft = await givenCatalogWithoutLedger();
      await linkDraftMigrationTable(kit, draft);

      const backfill = await planBackfill(kit, draft);

      expect(backfill).toEqual({
        status: 'refused',
        ...(await revisionsOf(draft)),
        refusal: {
          code: 'draftStructureChanged',
          tableIds: [SystemTables.Migration],
          message:
            'The Draft has a migration table that the Head does not have; ' +
            'revert the Draft natively, then run again',
        },
      });
    });

    it.each<UnreproducibleCase>([
      {
        schema: 'a foreign key to a missing table',
        given: (draft) =>
          commitHeadSchema(
            kit,
            draft,
            PRODUCTS,
            obj({ category: str({ foreignKey: 'missing' }), code: str() }),
          ),
        reason: 'Foreign key target "missing" is not a table of the Head',
      },
      {
        schema: 'a foreign key to a system table',
        given: (draft) =>
          commitHeadSchema(
            kit,
            draft,
            PRODUCTS,
            obj({
              category: str({ foreignKey: SystemTables.Schema }),
              code: str(),
            }),
          ),
        reason: `Foreign key target "${SystemTables.Schema}" is not a table of the Head`,
      },
      {
        schema: 'no schema row',
        given: (draft) => removeSchemaRow(kit, draft, PRODUCTS),
        reason: 'it has no schema row',
      },
      {
        schema: 'an invalid table id',
        given: (draft) =>
          renameHeadTableBelowNativeValidation(kit, draft, PRODUCTS, BAD_ID),
        tableId: BAD_ID,
        reason: 'Table ID must be',
      },
      {
        schema: 'an invalid field name',
        given: (draft) =>
          commitHeadSchema(kit, draft, PRODUCTS, obj({ '1code': str() })),
        reason: 'Invalid field names: 1code',
      },
      {
        schema: 'an invalid formula',
        given: (draft) =>
          commitHeadSchema(
            kit,
            draft,
            PRODUCTS,
            obj({ code: str(), total: numFormula('missing + 1') }),
          ),
        reason: `Formula validation error in field "total": Unknown field 'missing' in formula`,
      },
      {
        schema: 'a required name without a property',
        given: (draft) =>
          commitHeadSchema(kit, draft, PRODUCTS, {
            ...obj({ code: str() }),
            required: ['code', 'ghost'],
          }),
        reason: 'Not found required field "ghost" in "properties"',
      },
      {
        schema: 'an unknown $ref',
        given: (draft) =>
          commitHeadSchema(
            kit,
            draft,
            PRODUCTS,
            obj({ code: { $ref: 'urn:jsonschema:io:revisium:unknown:1.0.0' } }),
          ),
        reason:
          'Not found schema for $ref="urn:jsonschema:io:revisium:unknown:1.0.0"',
      },
    ])(
      'refuses a Head table with $schema and writes nothing',
      async ({ given, tableId = PRODUCTS, reason }) => {
        const draft = await givenCatalogWithoutLedger();
        await given(draft);
        const before = await branchContentsOf(kit, draft);

        const backfill = await planBackfill(kit, draft);

        expect(backfill).toEqual(
          await refusedWith(
            draft,
            'schemaNotReproducible',
            [tableId],
            expect.stringContaining(`"${tableId}": ${reason}`) as string,
          ),
        );
        expect(await branchContentsOf(kit, draft)).toEqual(before);
      },
    );

    it('names the table whose Head schema cannot be reproduced, not the tables that reference it', async () => {
      const draft = await givenCatalogWithoutLedger();
      await commitHeadSchema(
        kit,
        draft,
        CATEGORIES,
        obj({ parent: str({ foreignKey: 'missing' }), title: str() }),
      );

      const backfill = await planBackfill(kit, draft);

      expect(backfill).toEqual({
        status: 'refused',
        ...(await revisionsOf(draft)),
        refusal: {
          code: 'schemaNotReproducible',
          tableIds: [CATEGORIES],
          message:
            'The ledger cannot reproduce the Head schemas of "categories" ' +
            '("categories": Foreign key target "missing" is not a table of the Head); ' +
            'fix them natively and commit, then run again',
        },
      });
    });
  });

  describe('branch state', () => {
    it('needs nothing on a branch that has a migration table', async () => {
      const draft = await givenCommittedCatalog(kit);

      const backfill = await planBackfill(kit, draft);

      expect(backfill).toEqual({
        status: 'notNeeded',
        ...(await revisionsOf(draft)),
      });
    });

    it('refuses to plan while an async migration is active on the branch', async () => {
      const draft = await givenCatalogWithoutLedger();
      await givenActiveMigration(kit, draft, PRODUCTS);
      const before = await branchContentsOf(kit, draft);

      await expect(planBackfill(kit, draft)).rejects.toThrow(
        MigrationLockedException,
      );
      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it.each<BackfillInput>([
      { projectId: 'missing' },
      { branchName: 'missing' },
    ])(
      'rejects an unknown project or branch as the repair does: %p',
      async (unknown) => {
        const draft = await givenCatalogWithoutLedger();

        await expect(
          backfillLedger(kit, draft, { ...unknown, dryRun: true }),
        ).rejects.toThrow(
          new BadRequestException(
            'A branch with this name does not exist in the project',
          ),
        );
      },
    );
  });

  describe('request validation', () => {
    it.each<InvalidInputCase>([
      { input: { projectId: 5 }, message: 'projectId must be a string' },
      { input: { branchName: null }, message: 'branchName must be a string' },
      {
        input: { dryRun: 'yes' },
        message: 'dryRun must be a boolean',
      },
      {
        input: { dryRun: true, comment: 5 },
        message: 'comment must be a string',
      },
    ])(
      'rejects $input before any transaction: $message',
      async ({ input, message }) => {
        const draft = await givenCatalogWithoutLedger();

        const transactions = await transactionsStartedDuring(kit, () =>
          expect(backfillLedger(kit, draft, input)).rejects.toThrow(
            new BadRequestException(message),
          ),
        );

        expect(transactions).toBe(0);
      },
    );

    it('plans with comment given as null as it plans without it', async () => {
      const draft = await givenCatalogWithoutLedger();

      const backfill = await backfillLedger(kit, draft, {
        dryRun: true,
        comment: null,
      });

      expect(describedEntriesOf(backfill)).toEqual([
        'init categories',
        'init products',
      ]);
    });
  });

  function givenCatalogWithoutLedger(): Promise<BranchScenario> {
    return BranchScenario.committedWithoutLedger(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
    });
  }

  async function givenAuthorsAndBooksReferencingEachOther(): Promise<BranchScenario> {
    const draft = await BranchScenario.committedWithoutLedger(kit, {
      [AUTHORS]: { schema: authorSchema },
      [BOOKS]: { schema: bookSchema },
    });
    await draft.updateTable(AUTHORS, [
      addField('favourite', str({ foreignKey: BOOKS })),
    ]);
    await draft.commit();

    return draft;
  }

  async function givenThreeTableCycle(): Promise<BranchScenario> {
    return givenLettersWithBackReferences(
      { a: [], c: ['a'], b: ['c'] },
      { a: ['b'] },
    );
  }

  async function givenOverlappingCycles(): Promise<BranchScenario> {
    return givenLettersWithBackReferences(
      { a: [], b: ['a'], c: ['b'] },
      { a: ['b'], b: ['c'] },
    );
  }

  async function givenCycleMemberWithOrdinaryReference(): Promise<BranchScenario> {
    return givenLettersWithBackReferences(
      { z: [], a: ['z'], b: ['a'] },
      { a: ['b'] },
    );
  }

  async function givenTableReferencingCycle(): Promise<BranchScenario> {
    return givenLettersWithBackReferences(
      { c: [], d: ['c'], a: ['c'] },
      { c: ['d'] },
    );
  }

  async function givenCycleWithNativelyUpdatedB(
    a: JsonSchema,
  ): Promise<BranchScenario> {
    const draft = await BranchScenario.committedWithoutLedger(kit, {
      b: { schema: letterSchema() },
      a: { schema: a },
    });
    await draft.updateTable('b', [addField('a', str({ foreignKey: 'a' }))]);
    await draft.commit();

    return draft;
  }

  async function givenCycleWithoutSurvivor(): Promise<BranchScenario> {
    const draft = await BranchScenario.committedWithoutLedger(kit, {
      b: { schema: letterSchema({ name: str({ default: 'y' }) }) },
      a: {
        schema: letterSchema({
          b: str({ foreignKey: 'b' }),
          name: str({ default: 'x' }),
        }),
      },
      r: { schema: letterSchema({ a: str({ foreignKey: 'a' }) }) },
    });
    await commitHeadSchema(
      kit,
      draft,
      'b',
      letterSchema({
        a: str({ foreignKey: 'a' }),
        name: str({ default: 'y' }),
      }),
    );

    return draft;
  }

  async function givenLettersWithBackReferences(
    created: Readonly<Record<string, readonly string[]>>,
    added: Readonly<Record<string, readonly string[]>>,
  ): Promise<BranchScenario> {
    const tables: Record<string, TableFixture> = {};

    for (const [tableId, targets] of Object.entries(created)) {
      tables[tableId] = { schema: letterSchema(referencesTo(targets)) };
    }

    const draft = await BranchScenario.committedWithoutLedger(kit, tables);

    for (const [tableId, targets] of Object.entries(added)) {
      await draft.updateTable(
        tableId,
        targets.map((target) => addField(target, str({ foreignKey: target }))),
      );
    }

    await draft.commit();

    return draft;
  }

  async function refusedWith(
    draft: BranchScenario,
    code: BackfillRefusalCode,
    tableIds: string[],
    message: string = expect.any(String) as string,
  ): Promise<SchemaLedgerBackfill> {
    return {
      status: 'refused',
      ...(await revisionsOf(draft)),
      refusal: { code, tableIds, message },
    };
  }
});

function letterSchema(
  fields: Readonly<Record<string, JsonSchema>> = {},
): JsonObjectSchema {
  return obj({ name: str(), ...fields });
}

function referencesTo(targets: readonly string[]): Record<string, JsonSchema> {
  return Object.fromEntries(
    targets.map((target) => [target, str({ foreignKey: target })]),
  );
}

function describedEntriesOf(backfill: SchemaLedgerBackfill): string[] {
  return entriesOf(backfill).map(
    ({ changeType, tableId }) => `${changeType} ${tableId}`,
  );
}
