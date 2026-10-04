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

@QueryHandler(ProjectDraftChangesSchemaQuery)
export class ProjectDraftChangesSchemaHandler implements IQueryHandler<
  ProjectDraftChangesSchemaQuery,
  ProjectDraftChangesSchemaResult
> {
  async execute(
    query: ProjectDraftChangesSchemaQuery,
  ): Promise<ProjectDraftChangesSchemaResult> {
    return this.project(query);
  }

  private project(
    query: ProjectDraftChangesSchemaQuery,
  ): ProjectDraftChangesSchemaResult {
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
        ? this.commit(head, draft, partitions, refs)
        : this.discard(
            head,
            draft,
            partitions,
            query.data.discardedDataFields ?? [],
            refs,
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
  ): ProjectDraftChangesSchemaResult {
    const selected = projectTable(
      head.schema,
      head.rows,
      partitions.selected,
      refs,
    );
    const remaining = replayHistorySchema(
      selected.schema,
      partitions.remaining,
      refs,
    );
    if ('code' in remaining) {
      return blocked(remaining);
    }
    if (!deepEqual(remaining.schema, draft.schema)) {
      return blocked({
        code: 'DEPENDENT_EFFECT_SPLIT',
        message:
          'Remaining Draft schema history does not replay to the supplied Draft schema.',
      });
    }

    const all = projectTable(head.schema, head.rows, partitions.all, refs);
    const headState = makeState(
      selected.schema,
      [...head.history, ...selected.history],
      selected.rows,
    );
    const draftState = makeState(
      draft.schema,
      [...head.history, ...selected.history, ...remaining.history],
      draft.rows,
    );
    const migratedHead = makeState(
      all.schema,
      [...head.history, ...all.history],
      all.rows,
    );
    const lineage = createFieldIdentities(head.schema);
    const fullLineage = applyFieldLineage(lineage, partitions.all);
    const selectedLineage = applyFieldLineage(lineage, partitions.selected);

    return {
      status: 'projected',
      head: headState,
      draft: draftState,
      migratedHead,
      rowFieldMappings: mapFieldCoordinates(fullLineage, lineage),
      rowTargetFieldMappings: mapFieldCoordinates(fullLineage, selectedLineage),
      selectedEffects: partitions.selectedEffects,
    };
  }

  private discard(
    head: RevisionSchemaState,
    draft: RevisionSchemaState,
    partitions: HistoryPartition,
    discardedDataFields: Array<{ rowCreatedId: string; path: string }>,
    refs: Record<string, JsonSchema>,
  ): ProjectDraftChangesSchemaResult {
    const retained = projectTable(
      head.schema,
      head.rows,
      partitions.remaining,
      refs,
    );
    const full = projectTable(head.schema, head.rows, partitions.all, refs);
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
    const draftState = makeState(
      retained.schema,
      [...head.history, ...retainedHistory.history],
      residual.rows,
    );
    const headState = makeState(head.schema, head.history, head.rows);
    const migratedHead = makeState(
      full.schema,
      [...head.history, ...full.history],
      full.rows,
    );

    return {
      status: 'projected',
      head: headState,
      draft: draftState,
      migratedHead,
      rowFieldMappings: mapFieldCoordinates(fullLineage, lineage),
      rowTargetFieldMappings: mapFieldCoordinates(fullLineage, retainedLineage),
      selectedEffects: partitions.selectedEffects,
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
