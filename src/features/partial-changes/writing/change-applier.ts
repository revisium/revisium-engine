import { Injectable } from '@nestjs/common';
import type {
  TableWritePlan,
  TargetWritePlan,
} from 'src/features/draft-revision/commands/impl';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import type {
  ApplyChangesInput,
  NothingToApply,
  StoppedChangesBlocked,
  UnappliedChanges,
} from 'src/features/partial-changes/commands/impl/apply-changes';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import { plannedFieldsOf } from 'src/features/partial-changes/logging/partial-operation-fields';
import type { OperationTrace } from 'src/infrastructure/database/operation-log';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { ExpectedFingerprint } from 'src/features/partial-changes/plan/fingerprint';
import {
  type ChangePlan,
  ChangePlanner,
  type CompletePlan,
  type StoppedPlan,
} from 'src/features/partial-changes/planning/change-planner';
import {
  listedBlockersOf,
  listedRequiredOf,
} from 'src/features/partial-changes/planning/listed-details';
import { listedPlacesOf } from 'src/features/partial-changes/planning/plan-places';
import {
  changesSincePreview,
  decidePlanStatus,
  type PlanStatus,
} from 'src/features/partial-changes/planning/plan-decision';
import {
  selectsWholeDraft,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import {
  hasUnmatchedSelectors,
  type UnmatchedSelectors,
} from 'src/features/partial-changes/selection/selection-resolution';
import {
  validateRequiredAdditionsAcceptance,
  validateSelection,
} from 'src/features/partial-changes/selection/selection-validator';
import type {
  ChangesBranch,
  ComparedTable,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { refusalCodeOf } from 'src/features/partial-changes/head-schema/head-schema-check';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { TableEffectCheck } from 'src/features/partial-changes/writing/table-effect-check';
import { draftFollowsHeadPlanOf } from 'src/features/partial-changes/writing/target-write-plan-mapping';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

interface AppliedWrite {
  readonly draftHasChanges: boolean;
}

type TargetWrite<Applied> = (plan: CompletePlan) => Promise<Applied>;

interface ApplyRequest {
  readonly operation: ChangeOperation;
  readonly branch: ChangesBranch;
  readonly selection: Selection;
  readonly includeRequired: boolean;
  readonly expected?: ExpectedFingerprint;
}

type RefusalStatus = Exclude<PlanStatus, 'ready' | 'empty'>;

@Injectable()
export class ChangeApplier {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly draftWriteAdmission: DraftWriteAdmissionService,
    private readonly planner: ChangePlanner,
    private readonly limits: PartialChangesLimits,
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly draftRevisionTargetApi: DraftRevisionTargetApiService,
    private readonly effectCheck: TableEffectCheck,
  ) {}

  public apply<Applied extends AppliedWrite>(
    operation: ChangeOperation,
    input: ApplyChangesInput,
    writeTarget: TargetWrite<Applied>,
    trace: OperationTrace,
  ): Promise<Applied | UnappliedChanges> {
    const request = applyRequestOf(operation, input);

    return this.transactionRunner.runWrite(
      request.branch,
      (deadline) => this.planAndWrite(request, writeTarget, deadline, trace),
      trace,
    );
  }

  private async planAndWrite<Applied extends AppliedWrite>(
    request: ApplyRequest,
    writeTarget: TargetWrite<Applied>,
    deadline: DeadlineHandle,
    trace: OperationTrace,
  ): Promise<Applied | UnappliedChanges> {
    await this.admitDraftWrite(request.branch);

    const plan = await this.plan(request, deadline);
    trace.planned(() => plannedFieldsOf(plan));

    const { maxListedDetails } = this.limits;

    if (!plan.planned) {
      return stoppedByLimit(plan, maxListedDetails);
    }

    const status = decidePlanStatus(plan, request);

    if (status === 'empty') {
      return this.nothingToApply(plan, request, deadline, trace);
    }

    if (status !== 'ready') {
      return unappliedChangesOf(plan, status, request, maxListedDetails);
    }

    await deadline.checkpoint();

    // The write takes the whole plan; only a refusal lists its details cut (SPEC §5.1).
    const applied = await writeTarget(plan);

    return this.clearingWhatIsLeftWithoutEffect(
      applied,
      { request, plan },
      deadline,
      trace,
    );
  }

  // A written table keeps the rows that had no unit, so after exactly { all: true } a stale formula output can be left
  // beside the changes it applied; the same transaction plans the Draft again and normalises it when no unit is left.
  private async clearingWhatIsLeftWithoutEffect<Applied extends AppliedWrite>(
    applied: Applied,
    { request, plan }: { request: ApplyRequest; plan: CompletePlan },
    deadline: DeadlineHandle,
    trace: OperationTrace,
  ): Promise<Applied> {
    if (!applied.draftHasChanges || !selectsWholeDraft(request.selection)) {
      return applied;
    }

    const left = await this.plan(request, deadline);

    if (
      !left.planned ||
      left.appliedUnits.length > 0 ||
      left.blockers.length > 0
    ) {
      return applied;
    }

    const normalisation = await this.normalisationOf(left, request);

    if (!normalisation) {
      return applied;
    }

    return {
      ...applied,
      draftHasChanges: await this.normaliseDraft(
        plan,
        normalisation,
        deadline,
        trace,
      ),
    };
  }

  private async nothingToApply(
    plan: CompletePlan,
    request: ApplyRequest,
    deadline: DeadlineHandle,
    trace: OperationTrace,
  ): Promise<NothingToApply> {
    const normalisation = await this.normalisationOf(plan, request);

    if (!normalisation) {
      return nothingToApplyOf(
        plan,
        await this.snapshotReader.readDraftHasChanges(plan.draftRevisionId),
      );
    }

    return nothingToApplyOf(
      plan,
      await this.normaliseDraft(plan, normalisation, deadline, trace),
    );
  }

  // Links the Head versions of the Draft tables without a change with an effect; no unit is applied and no revision
  // created. The operation log keeps the fields of the plan the operation decided on.
  private async normaliseDraft(
    tracedPlan: CompletePlan,
    normalisation: TargetWritePlan,
    deadline: DeadlineHandle,
    trace: OperationTrace,
  ): Promise<boolean> {
    await deadline.checkpoint();

    const { draftHasChanges, relinkedTables } =
      await this.draftRevisionTargetApi.revertToTarget(normalisation);
    trace.planned(() => ({ ...plannedFieldsOf(tracedPlan), relinkedTables }));

    return draftHasChanges;
  }

  // Only exactly { all: true } reads every table; a narrower selection leaves the tables it did not read as they are
  // (SPEC §3.8).
  private async normalisationOf(
    plan: CompletePlan,
    { selection }: ApplyRequest,
  ): Promise<TargetWritePlan | undefined> {
    if (!selectsWholeDraft(selection)) {
      return undefined;
    }

    const normalisation = draftFollowsHeadPlanOf(
      plan.target,
      plan.target.source.snapshot,
    );

    if (normalisation.tables.length === 0) {
      return undefined;
    }

    const tables: TableWritePlan[] = [];

    for (const table of normalisation.tables) {
      tables.push(await this.followingHeadWithoutEffect(table, plan));
    }

    return { ...normalisation, tables };
  }

  // A user table whose remaining differences have no effect links its Head version: its content check is that of the
  // Draft reads, which leaves out schema hashes and formula outputs. Any other table keeps the content check of a
  // relink candidate.
  private async followingHeadWithoutEffect(
    table: TableWritePlan,
    plan: CompletePlan,
  ): Promise<TableWritePlan> {
    const compared = clearableTableOf(table, plan);

    if (
      !compared ||
      table.headVersionId === undefined ||
      (await this.effectCheck.hasChangeWithEffect(compared))
    ) {
      return table;
    }

    return {
      ...table,
      target: { kind: 'linked', versionId: table.headVersionId },
      relinkCandidate: false,
    };
  }

  private admitDraftWrite({
    projectId,
    branchName,
  }: ChangesBranch): Promise<void> {
    return this.draftWriteAdmission.admitBranchWrite(projectId, branchName);
  }

  private async plan(
    { operation, branch, selection }: ApplyRequest,
    deadline: DeadlineHandle,
  ): Promise<ChangePlan> {
    const compared = await this.planner.readComparedSnapshot({
      branch,
      selection,
    });

    return this.planner.plan({ operation, selection, compared }, deadline);
  }
}

function applyRequestOf(
  operation: ChangeOperation,
  { branch, selection, includeRequired, expected }: ApplyChangesInput,
): ApplyRequest {
  const acceptance = validateRequiredAdditionsAcceptance({
    includeRequired,
    expected,
  });

  return {
    operation,
    branch,
    selection: validateSelection(selection),
    ...acceptance,
  };
}

// A user table the reads analyse, with an unchanged structure (else it would have a structure unit). A table the partial
// operations refuse keeps the strict content check: its structure analysis cannot be trusted, since an async migration
// can rewrite the schema row both sides share while the Head rows keep their old shape (SPEC §6.10). Exactly
// { all: true } does not refuse tables, so the refusal is asked here.
function clearableTableOf(
  { identity }: TableWritePlan,
  { target: { source } }: CompletePlan,
): ComparedTable | undefined {
  const compared = source.tables.find((table) => table.identity === identity);
  const pair = source.snapshot.tables.find(
    (table) => table.identity === identity,
  );

  if (
    !compared ||
    !pair ||
    compared.structure.differs ||
    refusalCodeOf(pair, source.headSchema.sourceReplays) !== undefined
  ) {
    return undefined;
  }

  return compared;
}

function nothingToApplyOf(
  plan: CompletePlan,
  draftHasChanges: boolean,
): NothingToApply {
  return {
    status: 'empty',
    headRevisionId: plan.headRevisionId,
    draftRevisionId: plan.draftRevisionId,
    ...unmatchedSelectorsOf(plan),
    draftHasChanges,
  };
}

function stoppedByLimit(
  { blockers }: StoppedPlan,
  maxListedDetails: number,
): StoppedChangesBlocked {
  return {
    status: 'blocked',
    planned: false,
    ...listedBlockersOf(blockers, maxListedDetails),
    required: [],
    requiredTotal: 0,
  };
}

function unappliedChangesOf(
  plan: CompletePlan,
  status: RefusalStatus,
  request: ApplyRequest,
  maxListedDetails: number,
): UnappliedChanges {
  switch (status) {
    case 'required':
      return { status, ...listedRequiredOf(plan.required, maxListedDetails) };
    case 'blocked':
      return {
        status,
        planned: true,
        ...listedBlockersOf(plan.blockers, maxListedDetails),
        ...listedRequiredOf(plan.required, maxListedDetails),
        unmatched: plan.unmatched,
      };
    case 'stale':
      return {
        status,
        changed: changesSincePreview(plan, request),
        headRevisionId: plan.headRevisionId,
        draftRevisionId: plan.draftRevisionId,
        unmatched: plan.unmatched,
        ...listedPlacesOf(
          plan.target.source.catalogue,
          plan.appliedUnits,
          maxListedDetails,
        ),
      };
  }
}

function unmatchedSelectorsOf({ unmatched }: CompletePlan): {
  unmatched?: UnmatchedSelectors;
} {
  if (!hasUnmatchedSelectors(unmatched)) {
    return {};
  }

  return { unmatched };
}
