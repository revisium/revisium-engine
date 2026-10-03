import { ProjectDraftChangesSchemaHandler } from 'src/features/draft-changes/queries/handlers/project-draft-changes-schema.handler';
import { ProjectDraftChangesSchemaQuery } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type {
  ProjectDraftChangesSchemaQueryData,
  ProjectDraftChangesSchemaResult,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { JsonValue } from '@revisium/schema-toolkit/types';

export type ProjectionResult = ProjectDraftChangesSchemaResult;
export type ProjectedProjection = Extract<
  ProjectionResult,
  { status: 'projected' }
>;
export type BlockedProjection = Extract<
  ProjectionResult,
  { status: 'blocked' }
>;

export async function project(
  input: ProjectDraftChangesSchemaQueryData,
): Promise<ProjectDraftChangesSchemaResult> {
  const handler = new ProjectDraftChangesSchemaHandler();
  return handler.execute(new ProjectDraftChangesSchemaQuery(input));
}

export function requiredProjected(
  result: ProjectionResult,
): ProjectedProjection {
  if (result.status !== 'projected') {
    throw new Error(
      `Expected projection, received blockers: ${result.blockers.map(({ code }) => code).join(', ')}`,
    );
  }
  return result;
}

export function requiredBlocked(result: ProjectionResult): BlockedProjection {
  if (result.status !== 'blocked') {
    throw new Error('Expected schema projection to be blocked.');
  }
  return result;
}

export function requiredProjectionRow(
  state: { rows: Array<{ createdId: string; data: JsonValue }> },
  createdId: string,
) {
  const row = state.rows.find((candidate) => candidate.createdId === createdId);
  if (!row) {
    throw new Error(`Expected projected row '${createdId}'.`);
  }
  return row;
}

export function requiredProjectionBlocker(result: BlockedProjection) {
  const blocker = result.blockers[0];
  if (!blocker) {
    throw new Error('Expected at least one projection blocker.');
  }
  return blocker;
}
