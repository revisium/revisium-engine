import { QueryBus, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { detachState } from 'src/features/draft-changes/candidates/candidate-state';
import {
  findIdentityPrerequisite,
  missingParentRequirement,
} from 'src/features/draft-changes/candidates/candidate-prerequisites';
import {
  deniedDiscardDataRequirements,
  deniedValueChanges,
} from 'src/features/draft-changes/candidates/candidate-denied-changes';
import { schemaPrerequisite } from 'src/features/draft-changes/candidates/candidate-schema-prerequisites';
import { validateCandidateSelection } from 'src/features/draft-changes/candidates/candidate-selection-scope';
import { buildCommitCandidate } from 'src/features/draft-changes/candidates/commit-candidate';
import { buildDiscardCandidate } from 'src/features/draft-changes/candidates/discard-candidate';
import { validateCandidateStates } from 'src/features/draft-changes/candidates/candidate-validation';
import { projectCandidateSchemas } from 'src/features/draft-changes/candidates/schema-projections';
import {
  CalculateDataCandidatesQuery,
  type CalculateDataCandidatesQueryData,
  type CalculateDataCandidatesResult,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type { ProjectDraftChangesSchemaResult } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';

@QueryHandler(CalculateDataCandidatesQuery)
export class CalculateDataCandidatesHandler implements IQueryHandler<
  CalculateDataCandidatesQuery,
  CalculateDataCandidatesResult
> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  async execute(
    query: CalculateDataCandidatesQuery,
  ): Promise<CalculateDataCandidatesResult> {
    if (query.data.mode === 'restoreHead') {
      return this.restoreHead(query.data);
    }
    return this.calculateSelected(query.data);
  }

  private async restoreHead(
    data: Extract<CalculateDataCandidatesQueryData, { mode: 'restoreHead' }>,
  ): Promise<CalculateDataCandidatesResult> {
    const head = detachState(data.snapshot.head);
    const draft = detachState(data.snapshot.head);
    const blockers = await validateCandidateStates(head, draft, this.validator);
    return blockers.length > 0
      ? { status: 'blocked', blockers }
      : calculated(head, draft);
  }

  private async calculateSelected(
    data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  ): Promise<CalculateDataCandidatesResult> {
    const scopeBlockers = validateCandidateSelection(data);
    if (scopeBlockers.length > 0) {
      return { status: 'blocked', blockers: scopeBlockers };
    }
    if (
      data.selection.selected.length === 0 &&
      !data.additionalSchemaEffects?.length
    ) {
      return this.calculateUnchanged(data);
    }
    const parent = missingParentRequirement(
      data.operation,
      targetState(data),
      data.catalogue,
      data.selection,
    );
    if (parent) {
      return 'code' in parent
        ? { status: 'blocked', blockers: [parent] }
        : { status: 'needsEffects', requirements: [parent] };
    }
    const projected = await projectCandidateSchemas(
      data.snapshot,
      data.operation,
      data.selection,
      (query) => this.queryBus.execute(query),
      data.additionalSchemaEffects,
    );
    if (projected.status !== 'projected') {
      return this.resolveProjectionResult(projected, data);
    }
    const prerequisite = schemaPrerequisite(data, projected.projections);
    if (prerequisite) {
      return prerequisite;
    }
    const states =
      data.operation === 'commit'
        ? buildCommitCandidate(
            data.snapshot.head,
            data.snapshot.draft,
            data.selection.selected,
            projected.projections,
          )
        : buildDiscardCandidate(
            data.snapshot.head,
            data.snapshot.draft,
            data.selection.selected,
            projected.projections,
            data.selection.deniedTargets,
          );
    return this.validateCandidate(
      states.head,
      states.draft,
      data,
      projected.projections,
      projected.foreignKeyChanges,
    );
  }

  private async calculateUnchanged(
    data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  ): Promise<CalculateDataCandidatesResult> {
    const head = detachState(data.snapshot.head);
    const draft = detachState(data.snapshot.draft);
    const blockers = await validateCandidateStates(head, draft, this.validator);
    return blockers.length > 0
      ? { status: 'blocked', blockers }
      : calculated(head, draft);
  }

  private resolveProjectionResult(
    result: Exclude<
      Awaited<ReturnType<typeof projectCandidateSchemas>>,
      { status: 'projected' }
    >,
    data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  ): CalculateDataCandidatesResult {
    if (result.status !== 'needsEffects') {
      return result;
    }
    const blockers = deniedDiscardDataRequirements(
      result.requirements,
      data.selection,
    );
    return blockers.length > 0 ? { status: 'blocked', blockers } : result;
  }

  private async validateCandidate(
    head: DraftRevisionState,
    draft: DraftRevisionState,
    data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
    projections: Map<
      string,
      Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
    >,
    foreignKeyChanges: Extract<
      CalculateDataCandidatesResult,
      { status: 'calculated' }
    >['schemaForeignKeyChanges'],
  ): Promise<CalculateDataCandidatesResult> {
    const blockers = await validateCandidateStates(head, draft, this.validator);
    const denied = deniedValueChanges(
      data.operation,
      targetState(data),
      data.operation === 'commit' ? head : draft,
      data.selection,
      projections,
    );
    if (denied.length > 0) {
      return { status: 'blocked', blockers: denied };
    }
    if (blockers.length > 0) {
      const prerequisite = findIdentityPrerequisite(data, blockers);
      return prerequisite
        ? { status: 'needsEffects', requirements: [prerequisite] }
        : { status: 'blocked', blockers };
    }
    return calculated(head, draft, projections, foreignKeyChanges);
  }
}

function targetState(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): DraftRevisionState {
  return data.operation === 'commit' ? data.snapshot.head : data.snapshot.draft;
}

function calculated(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  projections?: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
  schemaForeignKeyChanges?: Extract<
    CalculateDataCandidatesResult,
    { status: 'calculated' }
  >['schemaForeignKeyChanges'],
): CalculateDataCandidatesResult {
  return {
    status: 'calculated',
    head,
    draft,
    migrationLedger: 'deferred',
    ...(schemaForeignKeyChanges === undefined
      ? {}
      : { schemaForeignKeyChanges }),
    ...(projections === undefined
      ? {}
      : {
          schemaProjectionBindings: [...projections].map(
            ([tableCreatedId, projection]) => ({
              tableCreatedId,
              rowFieldMappings: projection.rowFieldMappings,
              rowTargetFieldMappings: projection.rowTargetFieldMappings,
            }),
          ),
        }),
  };
}
