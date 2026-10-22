import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import { unionOfSelectors } from 'src/features/partial-changes-poc/__tests__/support/listed-units';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { Picker } from 'src/features/partial-changes-poc/__tests__/support/picker';
import { givenRandomDraft } from 'src/features/partial-changes-poc/__tests__/support/random-draft';
import { RowOutcome } from 'src/features/partial-changes-poc/assembly/target.types';
import type {
  ChangeOperation,
  ListedUnit,
  Selection,
} from 'src/features/partial-changes-poc/partial-changes.types';
import {
  ChangePlan,
  ChangePlanner,
} from 'src/features/partial-changes-poc/planning/change-planner.service';
import { DEFAULT_LIMITS } from 'src/features/partial-changes-poc/planning/operation-limits.service';
import {
  planBlockers,
  planStatus,
  requiredUnits,
} from 'src/features/partial-changes-poc/planning/plan-outcome';
import { PlanningTransaction } from 'src/features/partial-changes-poc/queries/planning-transaction.service';
import { sideOf } from 'src/features/partial-changes-poc/snapshot/snapshot.types';

const SEEDS = [2, 9, 17, 23, 42, 61];
const SELECTIONS_PER_DRAFT = 4;
const MAX_UNITS_PER_SELECTION = 2;
const EXCLUDE_CHANCE = 0.3;

describe('scoped reading property: the scoped plan equals the plan that reads every table (decision 3)', () => {
  let scoped: PartialChangesTestKit;
  let full: PartialChangesTestKit;

  beforeAll(async () => {
    scoped = await createPartialChangesTestKit();
    full = await createPartialChangesTestKit({
      limits: { ...DEFAULT_LIMITS, readScope: 'all' },
    });
  });

  guardCommittedVersions(() => scoped.guard);

  afterAll(async () => {
    await scoped.close();
    await full.close();
  });

  it.each(SEEDS)(
    'plans every random selection identically with scoped and full reading for seed %i',
    async (seed) => {
      const scenario = await givenRandomDraft(scoped, seed);
      const units = await scenario.listAllChanges();
      const pick = new Picker(seed + 1);
      const compared: string[] = [];

      for (let index = 0; index < SELECTIONS_PER_DRAFT; index++) {
        const { selection, operation } = randomSelection(units, pick);
        const scopedPlan = await planWith(
          scoped,
          scenario,
          operation,
          selection,
        );
        const fullPlan = await planWith(full, scenario, operation, selection);

        compared.push(
          `${operation} ${JSON.stringify(selection)} -> ${planStatus(scopedPlan, true)}, read ${scopedPlan.snapshot.changedRowCount} of ${fullPlan.snapshot.changedRowCount} changed rows`,
        );
        expect(projectionOf(scopedPlan)).toEqual(projectionOf(fullPlan));
      }

      process.stdout.write(
        `seed ${seed} compared:\n  ${compared.join('\n  ')}\n`,
      );
    },
  );

  it.each(SEEDS)(
    'applies a random selection with the status of the full plan for seed %i',
    async (seed) => {
      const scenario = await givenRandomDraft(scoped, seed);
      const units = await scenario.listAllChanges();
      const { selection, operation } = randomSelection(
        units,
        new Picker(seed + 2),
      );
      const fullPlan = await planWith(full, scenario, operation, selection);
      const options = {
        includeRequired: true,
        expected: fullPlan.fingerprint,
      };

      const result =
        operation === 'commit'
          ? await scenario.commit(selection, options)
          : await scenario.revert(selection, options);

      expect(result.status).toBe(
        planStatus(fullPlan, true) === 'ready' ? 'applied' : 'blocked',
      );
    },
  );
});

function randomSelection(
  units: readonly ListedUnit[],
  pick: Picker,
): { selection: Selection; operation: ChangeOperation } {
  const count = 1 + Math.floor(pick.next() * MAX_UNITS_PER_SELECTION);
  const chosen = Array.from({ length: count }, () => pick.one(units)).filter(
    (unit): unit is ListedUnit => unit !== undefined,
  );
  const selection: Selection = unionOfSelectors(chosen);
  const excluded = pick.one(units);
  if (excluded && !chosen.includes(excluded) && pick.next() < EXCLUDE_CHANCE) {
    selection.exclude = unionOfSelectors([excluded]);
  }
  return {
    selection,
    operation: pick.next() < 1 / 2 ? 'commit' : 'revert',
  };
}

function planWith(
  kit: PartialChangesTestKit,
  scenario: ChangesScenario,
  operation: ChangeOperation,
  selection: Selection,
): Promise<ChangePlan> {
  return kit.module
    .get(PlanningTransaction)
    .run(() =>
      kit.module
        .get(ChangePlanner)
        .plan({ branch: scenario.publicBranch, operation, selection }),
    );
}

function projectionOf(plan: ChangePlan) {
  return {
    status: planStatus(plan, true),
    fingerprint: plan.fingerprint,
    selected: [...plan.selected].sort(),
    applied: [...plan.applied].sort(),
    required: requiredUnits(plan),
    blockers: planBlockers(plan),
    unmatched: plan.unmatched,
    deferred: plan.target.deferred,
    estimate: { ...plan.estimate, changedRows: undefined },
    ledger: {
      target: plan.ledger.target.map((entry) => entry.migration.id),
      remaining: plan.ledger.remaining.map((entry) => entry.migration.id),
      renumbered: plan.ledger.renumbered.map(({ source }) => source.id),
    },
    tables: plan.target.tables
      .map((target) => ({
        table: target.table.pair.createdId,
        outcome: target.outcome === 'unchanged' ? 'base' : target.outcome,
        linkSide: target.linkSide,
        publicId: target.publicId,
        draftFollowsHead: Boolean(target.draftFollowsHead),
        rows: target.rows
          .filter(
            ({ row, outcome }) =>
              !(
                outcome.kind === 'base' ||
                (outcome.kind === 'absent' &&
                  !sideOf(row.pair, target.linkSide))
              ),
          )
          .map(({ row, outcome }) => ({
            row: row.pair.createdId,
            ...outcomeProjection(outcome),
          }))
          .sort((a, b) => (a.row < b.row ? -1 : 1)),
      }))
      .sort((a, b) => (a.table < b.table ? -1 : 1)),
    views: plan.target.views
      .map((view) => ({
        table: view.table.pair.createdId,
        viewsSide: view.viewsSide,
        structureSide: view.structureSide,
        doc: view.doc,
      }))
      .sort((a, b) => (a.table < b.table ? -1 : 1)),
  };
}

function outcomeProjection(outcome: RowOutcome) {
  switch (outcome.kind) {
    case 'absent':
      return { kind: outcome.kind };
    case 'merged':
      return {
        kind: outcome.kind,
        id: outcome.id,
        hash: outcome.hash,
        schemaHash: outcome.schemaHash,
        columns: outcome.columns,
      };
    default:
      return { kind: outcome.kind, version: outcome.version.versionId };
  }
}
