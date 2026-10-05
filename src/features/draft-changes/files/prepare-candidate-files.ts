import type { FileUsageApiService } from 'src/features/file-usage/file-usage-api.service';
import type { FileReferenceExtractorService } from 'src/features/file-usage/services/file-reference-extractor.service';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type {
  PrepareCandidateFilesQueryData,
  PrepareCandidateFilesResult,
} from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import { collectCandidateFileRows } from 'src/features/draft-changes/files/file-references';
import { createFileValidation } from 'src/features/draft-changes/files/file-validation';
import { buildFileSourceIndex } from 'src/features/draft-changes/files/file-sources';
import { createFileInitialization } from 'src/features/draft-changes/files/file-initialization';
import { prepareRoleFiles } from 'src/features/draft-changes/files/file-rows';
import {
  extractRowFileAccounting,
  reconcileFileAssociations,
} from 'src/features/draft-changes/files/file-associations';
import { detachedSnapshotBlobIds } from 'src/features/draft-changes/files/file-effects';

export async function prepareCandidateFiles(
  input: PrepareCandidateFilesQueryData,
  fileUsage: Pick<FileUsageApiService, 'getProjectFileBlobs'>,
  validator: JsonSchemaValidatorService,
  extractor: FileReferenceExtractorService,
): Promise<PrepareCandidateFilesResult> {
  const states = {
    head: structuredClone(input.head),
    draft: structuredClone(input.draft),
  };
  const validation = createFileValidation(validator);
  const sources = buildFileSourceIndex(input.snapshot, validation);
  const initialization = createFileInitialization(input, sources);
  const roles = await Promise.all(
    (['head', 'draft'] as const).map((role) =>
      prepareRoleFiles(
        role,
        collectCandidateFileRows(states[role]),
        validation,
        sources,
        initialization,
      ),
    ),
  );
  const blockers = roles.flatMap((role) => role.blockers);
  if (blockers.length > 0) {
    return { status: 'blocked', blockers };
  }
  const projectId = input.snapshot.branch.projectId;
  const accounting = extractRowFileAccounting(roles, extractor, projectId);
  const hashes = new Set(
    accounting.flatMap((row) => row.references.map(({ hash }) => hash)),
  );
  const blobs = await fileUsage.getProjectFileBlobs({
    projectId,
    hashes: [...hashes],
  });
  const associations = reconcileFileAssociations(accounting, blobs, projectId);
  if (associations.blockers.length > 0) {
    return { status: 'blocked', blockers: associations.blockers };
  }
  return {
    status: 'prepared',
    ...states,
    effects: [
      ...roles.flatMap((role) => role.effects),
      ...associations.effects,
    ],
    cleanupBlobIds: detachedSnapshotBlobIds(input.snapshot, [
      states.head,
      states.draft,
    ]),
  };
}
