import type { Migration } from '@revisium/schema-toolkit/types';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { ChangesScenario } from './support/changes-scenario';
import {
  ledgerOf,
  replayedSchemasOf,
  schemasOf,
} from './support/ledger-replaying';
import { givenRandomDraft, RANDOM_DRAFT_SEEDS } from './support/random-draft';
import {
  type ComparedColumns,
  comparedColumnsOf,
} from './support/revision-contents';
import type { RevisionSide } from './support/snapshot-reading';
import { UnitKindCoverage } from './support/unit-kind-coverage';

interface PublishedContent {
  readonly tables: Record<string, readonly ComparedColumns[]>;
  readonly migrations: readonly string[];
}

describe('committing listed units one by one over random Drafts (AS-65b)', () => {
  let kit: PartialChangesTestKit;
  const coverage = new UnitKindCoverage();

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(RANDOM_DRAFT_SEEDS)(
    'yields a Head equal to the original Draft, without changes left (seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      coverage.record(await draft.listEveryUnit());
      const original = await publishedContentOf(draft, 'draft');

      await commitListedUnitsOneByOne(draft, seededRandom(seed));

      expect(await publishedContentOf(draft, 'head')).toEqual(original);
      expect(await draft.hasChanges()).toBe(false);
      expect(await replayedSchemasOf(draft, 'head')).toEqual(
        await schemasOf(draft, 'head'),
      );
    },
  );

  it('commits every unit kind across its seeds', () => {
    expect(coverage.missingKinds()).toEqual([]);
  });

  async function commitListedUnitsOneByOne(
    draft: ChangesScenario,
    random: SeededRandom,
  ): Promise<void> {
    const listedAtStart = await draft.listEveryUnit();

    for (let committed = 0; committed < listedAtStart.length; committed += 1) {
      const units = await draft.listEveryUnit();

      if (units.length === 0) {
        return;
      }

      const unit = random.pick(units);

      expect({ unit, result: await commitAsReviewed(draft, unit) }).toEqual({
        unit,
        result: expect.objectContaining({ status: 'applied' }),
      });
    }

    expect(await draft.listEveryUnit()).toEqual([]);
  }

  async function commitAsReviewed(
    draft: ChangesScenario,
    { selector }: ListedUnit,
  ): Promise<CommitChangesResult> {
    const preview = await draft.previewChanges({
      operation: 'commit',
      selection: selector,
    });

    return draft.commitChanges({
      selection: selector,
      includeRequired: preview.status === 'required',
      expected: preview.fingerprint,
    });
  }

  // Renumbering gives the migrations that stayed in the Draft new ids and can publish them in another order, so
  // the ledger is compared as its migrations without ids; the replay check proves the published order.
  async function publishedContentOf(
    draft: ChangesScenario,
    side: RevisionSide,
  ): Promise<PublishedContent> {
    const tables = await comparedColumnsOf(kit, draft, side);

    return {
      tables: Object.fromEntries(
        Object.entries(tables).filter(
          ([tableId]) => tableId !== SystemTables.Migration,
        ),
      ),
      migrations: (await ledgerOf(draft, side))
        .map(withoutId)
        .sort((left, right) => left.localeCompare(right)),
    };
  }
});

function withoutId({ id: _id, ...migration }: Migration): string {
  return JSON.stringify(migration);
}
