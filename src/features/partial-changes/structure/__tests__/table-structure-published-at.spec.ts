import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { arr, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import {
  addField,
  removeField,
  replaceField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  analyzeStructure,
  pendingUpdate,
  type StructureScenario,
} from './support/table-structure-scenario';

const publishedAt = () => ref(SystemSchemaIds.RowPublishedAt);

describe('TableStructure: owner of the publishedAt column', () => {
  it.each<{ name: string; scenario: StructureScenario; owner: string }>([
    {
      name: 'an unchanged published-at field',
      scenario: {
        head: obj({ code: str(), releasedAt: publishedAt() }),
        draft: obj({ code: str(), releasedAt: publishedAt() }),
      },
      owner: 'field /releasedAt',
    },
    {
      name: 'a published-at field the Draft added',
      scenario: {
        head: obj({ code: str() }),
        draft: obj({ code: str(), releasedAt: publishedAt() }),
        pending: [pendingUpdate(addField('releasedAt', publishedAt()))],
      },
      owner: 'structure',
    },
    {
      name: 'a published-at field that replaced a plain value',
      scenario: {
        head: obj({ releasedAt: str() }),
        draft: obj({ releasedAt: publishedAt() }),
        pending: [pendingUpdate(replaceField('releasedAt', publishedAt()))],
      },
      owner: 'structure',
    },
    {
      name: 'a published-at field a later pending patch restored',
      scenario: {
        head: obj({ releasedAt: publishedAt() }),
        draft: obj({ releasedAt: publishedAt() }),
        pending: [
          pendingUpdate(replaceField('releasedAt', str())),
          pendingUpdate(replaceField('releasedAt', publishedAt())),
        ],
      },
      owner: 'structure',
    },
    {
      name: 'no RowPublishedAt leaf',
      scenario: { head: obj({ code: str() }), draft: obj({ code: str() }) },
      owner: 'rowColumns',
    },
    {
      name: 'a published-at field the Draft removed',
      scenario: {
        head: obj({ code: str(), releasedAt: publishedAt() }),
        draft: obj({ code: str() }),
        pending: [pendingUpdate(removeField('releasedAt'))],
      },
      owner: 'rowColumns',
    },
    {
      name: 'a RowPublishedAt inside an array',
      scenario: {
        head: obj({ releases: arr(obj({ at: publishedAt() })) }),
        draft: obj({ releases: arr(obj({ at: publishedAt() })) }),
      },
      owner: 'rowColumns',
    },
    {
      name: 'several RowPublishedAt leaves',
      scenario: {
        head: obj({ releasedAt: publishedAt(), reviewedAt: publishedAt() }),
        draft: obj({ releasedAt: publishedAt(), reviewedAt: publishedAt() }),
      },
      owner: 'rowColumns',
    },
  ])('gives the column to $owner for $name', ({ scenario, owner }) => {
    expect(publishedAtOwnerOf(analyzeStructure(scenario))).toBe(owner);
  });
});

function publishedAtOwnerOf(structure: TableStructure): string {
  const { publishedAtOwner } = structure;

  if (publishedAtOwner.owner === 'field') {
    return `field ${publishedAtOwner.pointer.toString()}`;
  }

  return publishedAtOwner.owner;
}
