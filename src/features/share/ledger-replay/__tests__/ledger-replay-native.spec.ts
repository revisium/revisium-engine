import { num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  JsonSchemaTypeName,
  type JsonSchema,
  type Migration,
} from '@revisium/schema-toolkit/types';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import {
  addField,
  init,
  remove,
  removeField,
  rename,
  replaceField,
  update,
} from './support/ledger-steps';
import {
  givenNativeDraft,
  replayWithNativeRules,
  type NativeDraft,
} from './support/native-draft';
import { givenDraftAfterRandomTableOperations } from './support/random-table-operations';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const OPERATIONS_PER_SEQUENCE = 30;

const categorySchema = obj({ title: str() });
const tagSchema = obj({ label: str() });
const productSchema = obj({ category: str({ foreignKey: 'categories' }) });

const nativeRejections: {
  name: string;
  given: Migration[];
  rejected: Migration;
}[] = [
  {
    name: 'an update whose patched schema breaks a formula',
    given: [
      init('products', obj({ price: num(), total: numFormula('price * 2') })),
    ],
    rejected: update('products', [removeField('price')]),
  },
  {
    name: 'a formula that names a missing field',
    given: [init('products', obj({ price: num() }))],
    rejected: update('products', [addField('total', numFormula('cost * 2'))]),
  },
  {
    name: 'a table with an invalid field name',
    given: [],
    rejected: init('products', obj({ __hidden: str() })),
  },
  {
    name: 'an added field with an invalid nested field name',
    given: [init('products', obj({ code: str() }))],
    rejected: update('products', [
      addField('details', obj({ __hidden: str() })),
    ]),
  },
  {
    name: 'a schema that violates the meta-schema',
    given: [],
    rejected: init('products', {
      type: JsonSchemaTypeName.Object,
      additionalProperties: false,
      required: ['code'],
      properties: { code: { type: JsonSchemaTypeName.String } as JsonSchema },
    }),
  },
  {
    name: 'a patch that violates the patch schema',
    given: [init('products', obj({ code: str() }))],
    rejected: update('products', [
      replaceField('code', { type: JsonSchemaTypeName.Number } as JsonSchema),
    ]),
  },
  {
    name: 'an update without patches',
    given: [init('products', obj({ code: str() }))],
    rejected: update('products', []),
  },
];

describe('ledger replay of native table operations', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(SEEDS)(
    'replays the Draft ledger from empty to the Draft schemas (seed %i)',
    async (seed) => {
      const draft = await givenDraftAfterRandomTableOperations(kit, {
        seed,
        operations: OPERATIONS_PER_SEQUENCE,
      });

      await expectLedgerToReplayToDraftSchemas(draft);
    },
  );

  describe('reused table ids', () => {
    it('replays a table created under an id that was renamed away', async () => {
      const draft = await givenNativeDraft(
        kit,
        init('categories', categorySchema),
        init('products', productSchema),
        rename('categories', 'groups'),
        init('categories', tagSchema),
      );

      await expectLedgerToReplayToDraftSchemas(draft);
    });

    it('replays a table renamed into an id that was removed', async () => {
      const draft = await givenNativeDraft(
        kit,
        init('categories', categorySchema),
        remove('categories'),
        init('tags', tagSchema),
        init('products', obj({ tag: str({ foreignKey: 'tags' }) })),
        rename('tags', 'categories'),
      );

      await expectLedgerToReplayToDraftSchemas(draft);
    });

    it('replays two tables swapped through a temporary id', async () => {
      const draft = await givenNativeDraft(
        kit,
        init('categories', categorySchema),
        init('products', productSchema),
        rename('categories', 'swapping'),
        rename('products', 'categories'),
        rename('swapping', 'products'),
      );

      await expectLedgerToReplayToDraftSchemas(draft);
    });
  });

  describe('native rejections', () => {
    it.each(nativeRejections)(
      'refuses $name with the native error',
      async ({ given, rejected }) => {
        const draft = await givenNativeDraft(kit, ...given);
        const nativeError = await errorOf(draft.write(rejected));

        const replay = replayWithNativeRules(kit, [
          ...(await draft.readLedger()),
          rejected,
        ]);

        expect(failureOf(replay, rejected)).toBe(nativeError);
      },
    );
  });

  async function expectLedgerToReplayToDraftSchemas(draft: NativeDraft) {
    const replay = replayWithNativeRules(kit, await draft.readLedger());

    expect(Object.fromEntries(replay.unreplayable)).toEqual({});
    expect(replay.unattributed).toEqual([]);
    expect(schemaMismatches(replay.schemas, await draft.readSchemas())).toEqual(
      [],
    );
  }
});

function schemaMismatches(
  replayed: ReadonlyMap<string, JsonSchema>,
  stored: ReadonlyMap<string, JsonSchema>,
) {
  const tableIds = new Set([...replayed.keys(), ...stored.keys()]);

  return [...tableIds]
    .map((tableId) => ({
      tableId,
      replayed: replayed.get(tableId),
      stored: stored.get(tableId),
    }))
    .filter(
      ({ replayed: replayedSchema, stored: storedSchema }) =>
        !replayedSchema ||
        !storedSchema ||
        !schemasEqual(replayedSchema, storedSchema),
    );
}

async function errorOf(write: Promise<unknown>): Promise<string> {
  const error = await write.then(
    () => null,
    (reason: Error) => reason,
  );
  if (!error) {
    throw new Error('The native writer accepted the step');
  }

  return error.message;
}

function failureOf(replay: ReplayedLedger, migration: Migration) {
  return [...replay.unreplayable.values(), ...replay.unattributed].find(
    ({ migrationId }) => migrationId === migration.id,
  )?.error;
}
