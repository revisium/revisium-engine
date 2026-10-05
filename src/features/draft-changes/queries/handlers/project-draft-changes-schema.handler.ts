import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { deepEqual, pluginRefs } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { ProjectDraftChangesSchemaQuery } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type {
  ProjectDraftChangesSchemaResult,
  SchemaProjectionBlocker,
  SchemaProjectionState,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import {
  applyFieldLineage,
  createFieldIdentities,
  mapFieldCoordinates,
} from 'src/features/draft-changes/schema/field-lineage';
import {
  partitionHistory,
  replayHistorySchema,
  validateHistoryPrefix,
  validateSchemaHistory,
} from 'src/features/draft-changes/schema/schema-history';
import type { HistoryPartition } from 'src/features/draft-changes/schema/schema-history';
import { readSchemaStates } from 'src/features/draft-changes/schema/schema-snapshot';
import type { RevisionSchemaState } from 'src/features/draft-changes/schema/schema-snapshot';
import { projectTable } from 'src/features/draft-changes/schema/schema-table-projection';
import { transferRowResiduals } from 'src/features/draft-changes/schema/row-residual';
import type { DraftChangesRevisionSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { SchemaForeignKeyChange } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import {
  applyForeignKeyHistoryProvenance,
  applyForeignKeyRetargets,
  createForeignKeyProvenance,
  validateForeignKeyRetargets,
} from 'src/features/draft-changes/schema/foreign-key-retarget';
import type { ValidatedForeignKeyRetarget } from 'src/features/draft-changes/schema/foreign-key-retarget';
import { projectFileSlots } from 'src/features/draft-changes/schema/file-slot-lineage';
import { applyReadyFileBaseline } from 'src/features/draft-changes/schema/ready-file-baseline';

type ProjectedSchemaPayload = Omit<
  Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>,
  'tableCreatedId' | 'sourceFingerprint'
>;
type InternalProjectionResult =
  | ProjectedSchemaPayload
  | { status: 'blocked'; blockers: SchemaProjectionBlocker[] };

@QueryHandler(ProjectDraftChangesSchemaQuery)
export class ProjectDraftChangesSchemaHandler implements IQueryHandler<
  ProjectDraftChangesSchemaQuery,
  ProjectDraftChangesSchemaResult
> {
  async execute(
    query: ProjectDraftChangesSchemaQuery,
  ): Promise<ProjectDraftChangesSchemaResult> {
    const result = this.project(query);
    if (result.status === 'blocked') {
      return result;
    }
    return {
      ...result,
      tableCreatedId: query.data.tableCreatedId,
      sourceFingerprint: query.data.snapshot.fingerprint,
    };
  }

  private project(
    query: ProjectDraftChangesSchemaQuery,
  ): InternalProjectionResult {
    const { snapshot, tableCreatedId, operation, effects } = query.data;
    const refs = {
      ...pluginRefs,
      ...(query.data.schemaRefs ?? {}),
    } as Record<string, JsonSchema>;
    const snapshotStates = readSchemaStates(snapshot, tableCreatedId);
    if ('blocker' in snapshotStates) {
      return blocked(snapshotStates.blocker);
    }
    const { head, draft } = snapshotStates.state;

    const headHistoryBlocker = validateSchemaHistory(
      head.schema,
      head.history,
      refs,
    );
    if (headHistoryBlocker) {
      return blocked(headHistoryBlocker);
    }
    const draftHistoryBlocker = validateSchemaHistory(
      draft.schema,
      draft.history,
      refs,
    );
    if (draftHistoryBlocker) {
      return blocked(draftHistoryBlocker);
    }
    const prefixBlocker = validateHistoryPrefix(head.history, draft.history);
    if (prefixBlocker) {
      return blocked(prefixBlocker);
    }
    const retargetValidation = validateForeignKeyRetargets(
      query.data.foreignKeyRetargets,
      snapshot.head.tables,
      snapshot.draft.tables,
    );
    if ('blocker' in retargetValidation) {
      return blocked(retargetValidation.blocker);
    }
    const partitions = partitionHistory(
      draft.history,
      head.history.length,
      effects,
    );
    if ('code' in partitions) {
      return blocked(partitions);
    }

    try {
      return operation === 'commit'
        ? this.commit(
            head,
            draft,
            partitions,
            refs,
            snapshot.head.tables,
            snapshot.draft.tables,
            retargetValidation.retargets,
          )
        : this.discard(
            head,
            draft,
            partitions,
            query.data.discardedDataFields ?? [],
            refs,
            snapshot.head.tables,
            snapshot.draft.tables,
            retargetValidation.retargets,
          );
    } catch {
      return blocked({
        code: 'DEPENDENT_EFFECT_SPLIT',
        message:
          'Schema effects could not be projected from the supplied snapshots.',
      });
    }
  }

  private commit(
    head: RevisionSchemaState,
    draft: RevisionSchemaState,
    partitions: HistoryPartition,
    refs: Record<string, JsonSchema>,
    headTables: DraftChangesRevisionSnapshot['tables'],
    draftTables: DraftChangesRevisionSnapshot['tables'],
    retargets: ValidatedForeignKeyRetarget[],
  ): InternalProjectionResult {
    const selected = projectTable(
      head.schema,
      head.rows,
      partitions.selected,
      refs,
    );
    selected.rows = applyReadyFileBaseline(
      selected.rows,
      draft.rows,
      projectFileSlots(partitions.all, partitions.selected, 'head'),
      'head',
    );
    const selectedState = makeState(
      selected.schema,
      [...head.history, ...selected.history],
      selected.rows,
    );
    const headProvenance = createForeignKeyProvenance(head.schema, 'head');
    const selectedProvenance = applyForeignKeyHistoryProvenance(
      headProvenance,
      partitions.selected,
      partitions.all,
    );
    const selectedRetargeted = applyForeignKeyRetargets(
      selectedState,
      'head',
      { head: headTables, draft: draftTables },
      selectedProvenance,
      retargets,
      'commit',
      refs,
    );
    if ('blocker' in selectedRetargeted) {
      return blocked(selectedRetargeted.blocker);
    }
    const remaining = replayHistorySchema(
      selectedRetargeted.state.schema,
      partitions.remaining,
      refs,
    );
    if ('code' in remaining) {
      return blocked(remaining);
    }
    const draftOriginal = applyForeignKeyRetargets(
      makeState(draft.schema, draft.history, draft.rows),
      'draft',
      { head: headTables, draft: draftTables },
      createForeignKeyProvenance(draft.schema, 'draft'),
      retargets,
      'commit',
      refs,
    );
    if ('blocker' in draftOriginal) {
      return blocked(draftOriginal.blocker);
    }
    const projectedDraftProvenance = applyForeignKeyHistoryProvenance(
      selectedProvenance,
      partitions.remaining,
    );
    const projectedDraft = applyForeignKeyRetargets(
      makeState(
        remaining.schema,
        [...selectedRetargeted.state.history, ...remaining.history],
        draft.rows,
      ),
      'draft',
      { head: headTables, draft: draftTables },
      projectedDraftProvenance,
      retargets,
      'commit',
      refs,
    );
    if ('blocker' in projectedDraft) {
      return blocked(projectedDraft.blocker);
    }
    if (!deepEqual(projectedDraft.state.schema, draftOriginal.state.schema)) {
      return blocked({
        code: 'DEPENDENT_EFFECT_SPLIT',
        message:
          'Remaining Draft schema history does not replay to the supplied Draft schema.',
      });
    }

    const all = projectTable(head.schema, head.rows, partitions.all, refs);
    all.rows = applyReadyFileBaseline(
      all.rows,
      draft.rows,
      projectFileSlots(partitions.all, partitions.all, 'head'),
      'head',
    );
    const migratedBase = makeState(
      all.schema,
      [...head.history, ...all.history],
      all.rows,
    );
    const migrated = applyForeignKeyRetargets(
      migratedBase,
      'head',
      { head: headTables, draft: draftTables },
      applyForeignKeyHistoryProvenance(headProvenance, partitions.all),
      retargets,
      'commit',
      refs,
    );
    if ('blocker' in migrated) {
      return blocked(migrated.blocker);
    }
    const historyBlocker = validateProjectedHistories(
      selectedRetargeted.state,
      projectedDraft.state,
      refs,
    );
    if (historyBlocker) {
      return blocked(historyBlocker);
    }
    const lineage = createFieldIdentities(head.schema);
    const fullLineage = applyFieldLineage(lineage, partitions.all);
    const selectedLineage = applyFieldLineage(lineage, partitions.selected);

    return {
      status: 'projected',
      head: selectedRetargeted.state,
      draft: projectedDraft.state,
      retainedHead: selectedRetargeted.state,
      migratedHead: migrated.state,
      rowFieldMappings: mapFieldCoordinates(fullLineage, lineage),
      rowTargetFieldMappings: mapFieldCoordinates(fullLineage, selectedLineage),
      selectedEffects: partitions.selectedEffects,
      fileSlots: [
        ...projectFileSlots(partitions.all, partitions.selected, 'head'),
        ...projectFileSlots(partitions.all, partitions.all, 'draft'),
      ],
      ...withForeignKeyChanges([
        ...selectedRetargeted.changes,
        ...projectedDraft.changes,
      ]),
    };
  }

  private discard(
    head: RevisionSchemaState,
    draft: RevisionSchemaState,
    partitions: HistoryPartition,
    discardedDataFields: Array<{ rowCreatedId: string; path: string }>,
    refs: Record<string, JsonSchema>,
    headTables: DraftChangesRevisionSnapshot['tables'],
    draftTables: DraftChangesRevisionSnapshot['tables'],
    retargets: ValidatedForeignKeyRetarget[],
  ): InternalProjectionResult {
    const retained = projectTable(
      head.schema,
      head.rows,
      partitions.remaining,
      refs,
    );
    const full = projectTable(head.schema, head.rows, partitions.all, refs);
    const retainedSlots = projectFileSlots(
      partitions.all,
      partitions.remaining,
      'draft',
    );
    const fullSlots = projectFileSlots(partitions.all, partitions.all, 'draft');
    retained.rows = applyReadyFileBaseline(
      retained.rows,
      draft.rows,
      retainedSlots,
      'draft',
    );
    full.rows = applyReadyFileBaseline(
      full.rows,
      draft.rows,
      fullSlots,
      'draft',
    );
    const lineage = createFieldIdentities(head.schema);
    const fullLineage = applyFieldLineage(lineage, partitions.all);
    const retainedLineage = applyFieldLineage(lineage, partitions.remaining);
    const residual = transferRowResiduals({
      fullSchema: full.schema,
      targetSchema: retained.schema,
      fullRows: full.rows,
      targetRows: retained.rows,
      draftRows: draft.rows,
      fullIdentities: fullLineage,
      targetIdentities: retainedLineage,
      discardedDataFields,
      refs,
    });
    if ('blocker' in residual) {
      return blocked(residual.blocker);
    }

    const retainedHistory = replayHistorySchema(
      head.schema,
      partitions.remaining,
      refs,
    );
    if ('code' in retainedHistory) {
      return blocked(retainedHistory);
    }
    const draftBase = makeState(
      retained.schema,
      [...head.history, ...retainedHistory.history],
      residual.rows,
    );
    const headState = makeState(head.schema, head.history, head.rows);
    const draftRetargeted = applyForeignKeyRetargets(
      draftBase,
      'draft',
      { head: headTables, draft: draftTables },
      applyForeignKeyHistoryProvenance(
        createForeignKeyProvenance(head.schema, 'head'),
        partitions.remaining,
        partitions.all,
      ),
      retargets,
      'discard',
      refs,
    );
    if ('blocker' in draftRetargeted) {
      return blocked(draftRetargeted.blocker);
    }
    const retainedHead = makeState(
      draftRetargeted.state.schema,
      draftRetargeted.state.history,
      retained.rows,
    );
    const migratedBase = makeState(
      full.schema,
      [...head.history, ...full.history],
      full.rows,
    );
    const migrated = applyForeignKeyRetargets(
      migratedBase,
      'draft',
      { head: headTables, draft: draftTables },
      applyForeignKeyHistoryProvenance(
        createForeignKeyProvenance(head.schema, 'head'),
        partitions.all,
      ),
      retargets,
      'discard',
      refs,
    );
    if ('blocker' in migrated) {
      return blocked(migrated.blocker);
    }
    const historyBlocker = validateProjectedHistories(
      headState,
      draftRetargeted.state,
      refs,
    );
    if (historyBlocker) {
      return blocked(historyBlocker);
    }

    return {
      status: 'projected',
      head: headState,
      draft: draftRetargeted.state,
      retainedHead,
      migratedHead: migrated.state,
      rowFieldMappings: mapFieldCoordinates(fullLineage, lineage),
      rowTargetFieldMappings: mapFieldCoordinates(fullLineage, retainedLineage),
      selectedEffects: partitions.selectedEffects,
      fileSlots: retainedSlots,
      ...withForeignKeyChanges(draftRetargeted.changes),
    };
  }
}

function makeState(
  schema: JsonSchema,
  history: SchemaProjectionState['history'],
  rows: SchemaProjectionState['rows'],
): SchemaProjectionState {
  return {
    schema: structuredClone(schema),
    history: structuredClone(history),
    rows: structuredClone(rows),
  };
}

function blocked(
  blocker: SchemaProjectionBlocker,
): ProjectDraftChangesSchemaResult {
  return { status: 'blocked', blockers: [blocker] };
}

function validateProjectedHistories(
  head: SchemaProjectionState,
  draft: SchemaProjectionState,
  refs: Record<string, JsonSchema>,
): SchemaProjectionBlocker | undefined {
  const prefixBlocker = validateHistoryPrefix(head.history, draft.history);
  if (prefixBlocker) {
    return prefixBlocker;
  }
  return (
    validateSchemaHistory(head.schema, head.history, refs) ??
    validateSchemaHistory(draft.schema, draft.history, refs)
  );
}

function withForeignKeyChanges(changes: SchemaForeignKeyChange[]): {
  foreignKeyChanges?: SchemaForeignKeyChange[];
} {
  if (changes.length === 0) {
    return {};
  }
  return {
    foreignKeyChanges: changes.sort(
      (left, right) =>
        (left.role === 'head' ? 0 : 1) - (right.role === 'head' ? 0 : 1) ||
        left.path.localeCompare(right.path) ||
        left.targetTableCreatedId.localeCompare(right.targetTableCreatedId),
    ),
  };
}
