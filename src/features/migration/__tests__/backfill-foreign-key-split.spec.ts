import { arr, obj, str } from '@revisium/schema-toolkit/mocks';
import { rules } from 'src/__tests__/fixtures/ledger-steps';
import {
  foreignKeySplitOf,
  survivesSplit,
} from 'src/features/migration/ledger-backfill/foreign-key-split';

const BOOKS = 'books';
const PEOPLE = 'people';

const bookReference = str({ foreignKey: BOOKS });
const personReference = str({ foreignKey: PEOPLE });

describe('Foreign-key split of a backfilled table', () => {
  const headSchema = obj({
    tags: arr(obj({ book: bookReference })),
    Zebra: bookReference,
    profile: obj({ book: bookReference, editor: personReference }),
    favourites: arr(bookReference),
    name: str(),
  });

  it('strips the deferred foreign keys and restores each with one replace of its Head subschema, in code-point order of the pointers', () => {
    const split = foreignKeySplitOf(headSchema, new Set([BOOKS]));

    expect(split).toEqual({
      initSchema: obj({
        tags: arr(obj({ book: str() })),
        Zebra: str(),
        profile: obj({ book: str(), editor: personReference }),
        favourites: arr(str()),
        name: str(),
      }),
      patches: [
        {
          op: 'replace',
          path: '/properties/Zebra',
          value: bookReference,
        },
        {
          op: 'replace',
          path: '/properties/favourites/items',
          value: bookReference,
        },
        {
          op: 'replace',
          path: '/properties/profile/properties/book',
          value: bookReference,
        },
        {
          op: 'replace',
          path: '/properties/tags/items/properties/book',
          value: bookReference,
        },
      ],
    });
    expect(survivesSplit(rules, headSchema, split)).toBe(true);
  });

  it('does not survive when rebuilding the schema loses part of the Head schema', () => {
    const withDefault = obj({
      book: bookReference,
      name: str({ default: 'x' }),
    });

    const split = foreignKeySplitOf(withDefault, new Set([BOOKS]));

    expect(survivesSplit(rules, withDefault, split)).toBe(false);
  });

  it('does not survive a split that strips nothing', () => {
    const split = foreignKeySplitOf(headSchema, new Set(['missing']));

    expect(split.patches).toEqual([]);
    expect(survivesSplit(rules, headSchema, split)).toBe(false);
  });
});
