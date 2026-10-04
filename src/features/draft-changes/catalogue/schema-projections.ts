import type { BuildDraftChangesCatalogueResult } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ProjectDraftChangesSchemaResult } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { TablePair } from 'src/features/draft-changes/catalogue/snapshot-pairs';

export function validateSchemaProjections(
  sourceFingerprint: string,
  pairs: TablePair[],
  inputs: Array<{
    tableCreatedId: string;
    projection: ProjectDraftChangesSchemaResult;
  }>,
):
  | Map<
      string,
      Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
    >
  | { blocker: BuildDraftChangesCatalogueResult } {
  const projectionMap = new Map<string, ProjectDraftChangesSchemaResult>();
  for (const input of inputs) {
    if (projectionMap.has(input.tableCreatedId)) {
      return {
        blocker: blocked(
          'SCHEMA_PROJECTION_MISMATCH',
          'More than one projection was supplied for a table.',
          input.tableCreatedId,
        ),
      };
    }
    projectionMap.set(input.tableCreatedId, input.projection);
  }
  const result = new Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >();
  for (const pair of pairs) {
    const validation = validatePairProjection(
      sourceFingerprint,
      pair,
      projectionMap.get(pair.createdId),
    );
    if ('blocker' in validation) {
      return { blocker: validation.blocker };
    }
    if (!validation.projection) {
      continue;
    }
    result.set(pair.createdId, validation.projection);
    projectionMap.delete(pair.createdId);
  }
  if (projectionMap.size > 0) {
    return {
      blocker: blocked(
        'SCHEMA_PROJECTION_MISMATCH',
        'A schema projection was supplied for an unknown table.',
        projectionMap.keys().next().value,
      ),
    };
  }
  return result;
}

function validatePairProjection(
  sourceFingerprint: string,
  pair: TablePair,
  projection: ProjectDraftChangesSchemaResult | undefined,
):
  | {
      projection?: Extract<
        ProjectDraftChangesSchemaResult,
        { status: 'projected' }
      >;
    }
  | { blocker: BuildDraftChangesCatalogueResult } {
  const shared = Boolean(pair.head && pair.draft);
  if (!shared) {
    if (projection) {
      return {
        blocker: blocked(
          'SCHEMA_PROJECTION_MISMATCH',
          'One-sided table lifecycle must not carry a schema projection.',
          pair.createdId,
        ),
      };
    }
    return {};
  }
  if (!projection) {
    return {
      blocker: blocked(
        'SCHEMA_PROJECTION_MISMATCH',
        `Missing full schema projection for shared table '${pair.createdId}'.`,
        pair.createdId,
      ),
    };
  }
  if (projection.status === 'blocked') {
    return {
      blocker: blocked(
        'SCHEMA_PROJECTION_BLOCKED',
        'The full schema projection is blocked.',
        pair.createdId,
      ),
    };
  }
  if (projection.sourceFingerprint !== sourceFingerprint) {
    return {
      blocker: blocked(
        'SCHEMA_PROJECTION_SNAPSHOT_MISMATCH',
        'The schema projection was produced from a different source snapshot.',
        pair.createdId,
      ),
    };
  }
  if (projection.tableCreatedId !== pair.createdId) {
    return {
      blocker: blocked(
        'SCHEMA_PROJECTION_TABLE_MISMATCH',
        'The schema projection belongs to a different stable table.',
        pair.createdId,
      ),
    };
  }
  return { projection };
}

function blocked(
  code:
    | 'SCHEMA_PROJECTION_BLOCKED'
    | 'SCHEMA_PROJECTION_SNAPSHOT_MISMATCH'
    | 'SCHEMA_PROJECTION_TABLE_MISMATCH'
    | 'SCHEMA_PROJECTION_MISMATCH',
  message: string,
  tableCreatedId?: string,
): BuildDraftChangesCatalogueResult {
  return { status: 'blocked', blockers: [{ code, message, tableCreatedId }] };
}
