import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import { publicPartOf } from 'src/features/partial-changes-poc/__tests__/support/listed-units';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { givenRandomDraft } from 'src/features/partial-changes-poc/__tests__/support/random-draft';
import type {
  ApplyChangesResult,
  ChangeOperation,
  ListedUnit,
} from 'src/features/partial-changes-poc/partial-changes.types';

const SEEDS = [5, 8, 13, 21, 34, 55];
const MAX_STEPS = 60;

describe('unit completeness property: listed units account for every Draft difference (decision 1)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  it.each(SEEDS)(
    'reverting the listed units one by one leaves the Draft equal to Head for seed %i',
    async (seed) => {
      const scenario = await givenRandomDraft(kit, seed);
      const head = await scenario.revisionContent('head');

      const steps = await applyListedOneByOne(scenario, 'revert');

      process.stdout.write(
        `seed ${seed} revert steps:\n  ${steps.join('\n  ')}\n`,
      );
      expect(await scenario.listAllChanges()).toEqual([]);
      expect(await scenario.revisionContent('draft')).toEqual(head);
      expect(await scenario.revisionContent('head')).toEqual(head);
      expect(await scenario.draftHasChanges()).toBe(false);
    },
  );

  it.each(SEEDS)(
    'committing the listed units one by one yields a Head equal to the whole Draft for seed %i',
    async (seed) => {
      const scenario = await givenRandomDraft(kit, seed);
      const draft = await scenario.revisionContent('draft');

      const steps = await applyListedOneByOne(scenario, 'commit');

      process.stdout.write(
        `seed ${seed} commit steps:\n  ${steps.join('\n  ')}\n`,
      );
      expect(await scenario.listAllChanges()).toEqual([]);
      expect(await scenario.revisionContent('head')).toEqual(draft);
      expect(await scenario.revisionContent('draft')).toEqual(draft);
      expect(await scenario.draftHasChanges()).toBe(false);
    },
  );
});

async function applyListedOneByOne(
  scenario: ChangesScenario,
  operation: ChangeOperation,
): Promise<string[]> {
  const steps: string[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const [unit] = await scenario.listAllChanges();
    if (!unit) {
      return steps;
    }
    const result = await applyOne(scenario, operation, unit);
    steps.push(`${describeUnit(unit)} -> ${result.status}`);
    expect({ unit: publicPartOf(unit), status: result.status }).toEqual({
      unit: publicPartOf(unit),
      status: 'applied',
    });
  }
  throw new Error(`Units still listed after ${MAX_STEPS} steps`);
}

async function applyOne(
  scenario: ChangesScenario,
  operation: ChangeOperation,
  unit: ListedUnit,
): Promise<ApplyChangesResult> {
  const selection = unit.selector ?? {};
  const preview = await scenario.preview(operation, selection, true);
  const options = {
    includeRequired: preview.status === 'ready' && preview.counts.required > 0,
    expected: preview.fingerprint,
  };
  return operation === 'commit'
    ? scenario.commit(selection, options)
    : scenario.revert(selection, options);
}

function describeUnit(unit: ListedUnit): string {
  return [unit.kind, unit.tableId, unit.rowId, unit.path]
    .filter((part) => part !== undefined)
    .join(' ');
}
