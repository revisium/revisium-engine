import { obj, str } from '@revisium/schema-toolkit/mocks';
import { HeadSyncedReplica } from 'src/__tests__/fixtures/ledger-replicas';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  ApplyChangesInput,
  ApplyStatus,
} from 'src/features/partial-changes/commands/impl/apply-changes';
import type {
  CommitChangesResult,
  RenumberedMigration,
} from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import type { ChangesScenario } from './changes-scenario';
import { unionOfSelections } from './dependency-closing';
import {
  givenRandomDraftInEditing,
  type RandomDraftWriter,
  type RandomEdit,
} from './random-draft';

const STEP_WEIGHTS = {
  editData: 5,
  editSchema: 4,
  commitUnits: 4,
  revertUnits: 3,
  commitNatively: 1,
  revertNatively: 1,
} as const;

export type RandomStepKind = keyof typeof STEP_WEIGHTS;

const RANDOM_STEP_KINDS = Object.keys(STEP_WEIGHTS) as RandomStepKind[];

type StepKind = RandomStepKind | 'commitLaterTable' | 'commitEverything';

const MAX_UNITS_PER_SELECTION = 3;
const EARLIER_TABLE = 'earlier';
const LATER_TABLE = 'later';
const labelSchema = obj({ label: str() });

export interface StepRecord {
  readonly number: number;
  readonly kind: StepKind;
  readonly edit?: RandomEdit;
  readonly selection?: Selection;
}

export interface TakenStep {
  readonly step: StepRecord;
  readonly status: ApplyStatus;
  readonly renumbered: readonly RenumberedMigration[];
}

type ReviewedApplication = Omit<ApplyChangesInput, 'branch'>;

interface DraftState {
  readonly units: readonly ListedUnit[];
  readonly hasChanges: boolean;
}

// Every choice of a sequence (the Draft's edits, the step kinds and the selected units) comes from one seeded stream,
// so a seed replays the same sequence.
export class ReplicaSequence {
  private taken = 0;

  private constructor(
    public readonly draft: ChangesScenario,
    public readonly replica: HeadSyncedReplica,
    private readonly writer: RandomDraftWriter,
    private readonly random: SeededRandom,
  ) {}

  public static async overRandomDraft(
    kit: PartialChangesTestKit,
    seed: number,
  ): Promise<ReplicaSequence> {
    const random = seededRandom(seed);
    const { draft, writer } = await givenRandomDraftInEditing(kit, random);
    const replica = await HeadSyncedReplica.of(kit);
    await replica.syncWith(draft);

    return new ReplicaSequence(draft, replica, writer, random);
  }

  // The later table's migration is the last pending one, so committing that table alone leaves every other pending
  // migration before the published one.
  public async commitTheLaterOfTwoNewTables(): Promise<TakenStep> {
    await this.draft.createTable(EARLIER_TABLE, labelSchema);
    await this.draft.createTable(LATER_TABLE, labelSchema);

    return this.commitAsReviewed('commitLaterTable', {
      structures: [{ tableId: LATER_TABLE }],
    });
  }

  public async takeRandomStep(): Promise<TakenStep> {
    const state = await this.readDraftState();

    return this.take(this.random.pick(applicableStepsOf(state)), state);
  }

  public commitEverything(): Promise<TakenStep> {
    return this.commitAsReviewed('commitEverything', { all: true });
  }

  private take(kind: RandomStepKind, state: DraftState): Promise<TakenStep> {
    switch (kind) {
      case 'editData':
        return this.editData();
      case 'editSchema':
        return this.editSchema();
      case 'commitUnits':
        return this.commitAsReviewed(kind, this.selectionOf(state.units));
      case 'revertUnits':
        return this.revertAsReviewed(kind, this.selectionOf(state.units));
      case 'commitNatively':
        return this.commitNatively();
      case 'revertNatively':
        return this.revertNatively();
    }
  }

  private async editData(): Promise<TakenStep> {
    const edit = await this.writer.writeRandomDataEdit();

    return this.recorded({ kind: 'editData', edit }, 'applied');
  }

  private async editSchema(): Promise<TakenStep> {
    const edit = await this.writer.writeRandomSchemaEdit();

    return this.recorded({ kind: 'editSchema', edit }, 'applied');
  }

  private async commitNatively(): Promise<TakenStep> {
    await this.draft.commit();
    await this.writer.followHead();

    return this.recorded({ kind: 'commitNatively' }, 'applied');
  }

  private async revertNatively(): Promise<TakenStep> {
    await this.draft.revertNatively();

    return this.recorded({ kind: 'revertNatively' }, 'applied');
  }

  private async commitAsReviewed(
    kind: StepKind,
    selection: Selection,
  ): Promise<TakenStep> {
    const result = await this.draft.commitChanges(
      await this.reviewed('commit', selection),
    );
    await this.writer.followHead();

    return this.recorded(
      { kind, selection },
      result.status,
      renumberedOf(result),
    );
  }

  private async revertAsReviewed(
    kind: StepKind,
    selection: Selection,
  ): Promise<TakenStep> {
    const result = await this.draft.revertChanges(
      await this.reviewed('revert', selection),
    );

    return this.recorded({ kind, selection }, result.status);
  }

  private async reviewed(
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<ReviewedApplication> {
    const preview = await this.draft.previewChanges({ operation, selection });

    return {
      selection,
      includeRequired: preview.status === 'required',
      expected: preview.fingerprint,
    };
  }

  private selectionOf(units: readonly ListedUnit[]): Selection {
    const unselected = [...units];
    const selected: ListedUnit[] = [];
    const count = this.random.count(1, MAX_UNITS_PER_SELECTION);

    while (selected.length < count && unselected.length > 0) {
      const unit = this.random.pick(unselected);
      selected.push(unit);
      unselected.splice(unselected.indexOf(unit), 1);
    }

    return unionOfSelections(selected.map(({ selector }) => selector));
  }

  private async readDraftState(): Promise<DraftState> {
    return {
      units: await this.draft.listEveryUnit(),
      hasChanges: await this.draft.hasChanges(),
    };
  }

  private recorded(
    step: Omit<StepRecord, 'number'>,
    status: ApplyStatus,
    renumbered: readonly RenumberedMigration[] = [],
  ): TakenStep {
    this.taken += 1;

    return { step: { number: this.taken, ...step }, status, renumbered };
  }
}

export class StepKindCoverage {
  private readonly seen = new Set<StepKind>();
  private renumberingCommits = 0;

  public record({ step, renumbered }: TakenStep): void {
    this.seen.add(step.kind);

    if (step.kind === 'commitUnits' && renumbered.length > 0) {
      this.renumberingCommits += 1;
    }
  }

  public missingKinds(): RandomStepKind[] {
    return RANDOM_STEP_KINDS.filter((kind) => !this.seen.has(kind));
  }

  public get randomCommitsThatRenumbered(): number {
    return this.renumberingCommits;
  }
}

function applicableStepsOf(state: DraftState): RandomStepKind[] {
  return RANDOM_STEP_KINDS.filter((kind) => isApplicable(kind, state)).flatMap(
    (kind) => Array.from({ length: STEP_WEIGHTS[kind] }, () => kind),
  );
}

function isApplicable(kind: RandomStepKind, state: DraftState): boolean {
  switch (kind) {
    case 'editData':
    case 'editSchema':
      return true;
    case 'commitUnits':
    case 'revertUnits':
      return state.units.length > 0;
    case 'commitNatively':
    case 'revertNatively':
      return state.hasChanges;
  }
}

function renumberedOf(
  result: CommitChangesResult,
): readonly RenumberedMigration[] {
  if (result.status !== 'applied') {
    return [];
  }

  return result.renumbered;
}
