import objectHash from 'object-hash';
import {
  createJsonSchemaStore,
  createJsonValueStore,
  pluginRefs,
} from '@revisium/schema-toolkit/lib';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { SchemaFileSlotProjectionBinding } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import { FileStatus } from 'src/features/plugin/file/consts';
import { FileValueStore } from 'src/features/plugin/file/file-value.store';
import { initializeReadyFile } from 'src/features/plugin/file/utils/initialize-ready-file';
import type {
  PrepareCandidateFilesQueryData,
  CandidateFileEffect,
  CandidateFileBlocker,
} from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import type {
  CandidateFileRow,
  CandidateFileReference,
} from 'src/features/draft-changes/files/file-references';
import type { NativeFileCell } from 'src/features/draft-changes/files/file-validation';
import { resolveInitializationSource } from 'src/features/draft-changes/files/file-sources';
import type { FileSourceIndex } from 'src/features/draft-changes/files/file-sources';
import { setJsonPath } from 'src/features/draft-changes/schema/json-value-path';
import {
  createCandidateFileBlocker,
  createInitializationEffect,
} from 'src/features/draft-changes/files/file-effects';

export type FileInitialization =
  | { status: 'absent' }
  | { status: 'valid'; fileId: string; sourceStatus: FileStatus }
  | { status: 'invalid'; message: string };

export interface FileInitializationContext {
  getSource(
    role: 'head' | 'draft',
    reference: CandidateFileReference,
  ): Promise<FileInitialization>;
  isUninitialized(file: FileValueStore): boolean;
  matchesReady(file: FileValueStore, fileId: string): boolean;
}

export function createFileInitialization(
  input: PrepareCandidateFilesQueryData,
  sources: FileSourceIndex,
): FileInitializationContext {
  const paths = projectedSourcePaths(input);
  const schema = pluginRefs[SystemSchemaIds.File];
  if (!schema) {
    throw new Error('Native File schema is unavailable.');
  }
  const schemaStore = createJsonSchemaStore(schema, pluginRefs);
  const store = createJsonValueStore(schemaStore, '', schemaStore.default);
  if (store.type !== JsonSchemaTypeName.Object) {
    throw new Error('Native File schema must be an object.');
  }
  const baseline = new FileValueStore(store);
  return {
    async getSource(role, reference) {
      const path = paths.get(
        initializationKey(role, reference.tableCreatedId, reference.path),
      );
      if (path === undefined) {
        return { status: 'absent' };
      }
      const source = await resolveInitializationSource(
        sources,
        reference.tableCreatedId,
        reference.rowCreatedId,
        path,
      );
      if (!source || source.status === 'invalid') {
        return {
          status: 'invalid',
          message: source?.message ?? 'Projected source file is unavailable.',
        };
      }
      if (
        ![FileStatus.ready, FileStatus.uploaded].includes(
          source.cell.file.status,
        )
      ) {
        return {
          status: 'invalid',
          message: 'Projected source is not a ready or uploaded file.',
        };
      }
      return {
        status: 'valid',
        fileId: source.cell.file.fileId,
        sourceStatus: source.cell.file.status,
      };
    },
    isUninitialized(file) {
      if (
        file.fileId ||
        file.fileName ||
        file.url ||
        !['', FileStatus.ready].includes(file.status)
      ) {
        return false;
      }
      baseline.status = file.status;
      baseline.fileId = '';
      return matchesBaseline(file, baseline);
    },
    matchesReady(file, fileId) {
      initializeReadyFile(baseline, fileId);
      return matchesBaseline(file, baseline);
    },
  };
}

function projectedSourcePaths(
  input: PrepareCandidateFilesQueryData,
): Map<string, string> {
  const paths = new Map<string, string>();
  for (const binding of input.schemaProjectionBindings ?? []) {
    if (
      binding.sourceFingerprint !== input.snapshot.fingerprint ||
      !binding.operation ||
      !binding.selectedEffects
    ) {
      continue;
    }
    const effects = new Set(
      binding.selectedEffects?.map(
        (effect) => `${effect.historyIndex}:${effect.patchIndex}`,
      ),
    );
    for (const slot of binding.fileSlots ?? []) {
      if (isActiveFileSlot(binding.operation, slot, effects)) {
        paths.set(
          initializationKey(
            slot.role,
            binding.tableCreatedId,
            slot.projectedPath,
          ),
          slot.sourceDraftPath,
        );
      }
    }
  }
  return paths;
}

function isActiveFileSlot(
  operation: 'commit' | 'discard',
  slot: SchemaFileSlotProjectionBinding,
  selectedEffects: Set<string>,
): boolean {
  const selected = selectedEffects.has(
    `${slot.introducedBy.historyIndex}:${slot.introducedBy.patchIndex}`,
  );
  if (slot.role === 'head') {
    return operation === 'commit' && selected;
  }
  return operation === 'commit' || !selected;
}

function initializationKey(
  role: 'head' | 'draft',
  tableCreatedId: string,
  path: string,
): string {
  return `${tableCreatedId}:${role}:${path}`;
}

function matchesBaseline(
  file: FileValueStore,
  baseline: FileValueStore,
): boolean {
  try {
    file.checkImmutable(baseline);
    return true;
  } catch {
    return false;
  }
}

export function initializeCandidateFile(
  row: CandidateFileRow,
  reference: CandidateFileReference,
  cell: NativeFileCell,
  fileId: string,
): string | undefined {
  initializeReadyFile(cell.file, fileId);
  const result = setJsonPath(
    row.row.data as JsonValue,
    reference.path,
    cell.store.getPlainValue(),
  );
  if (!result.representable) {
    return 'Projected file destination is not representable.';
  }
  row.row.data = result.value;
  reference.value = cell.store.getPlainValue();
  row.row.hash = objectHash(row.row.data);
  return undefined;
}

export function initializedFileEffect(
  role: 'head' | 'draft',
  reference: CandidateFileReference,
  initialization: Extract<FileInitialization, { status: 'valid' }>,
): CandidateFileEffect | undefined {
  if (role === 'draft' && initialization.sourceStatus !== FileStatus.uploaded) {
    return undefined;
  }
  return createInitializationEffect(role, reference, initialization.fileId);
}

export function prepareFileInitialization(
  role: 'head' | 'draft',
  row: CandidateFileRow,
  reference: CandidateFileReference,
  cell: NativeFileCell,
  context: FileInitializationContext,
  birth: FileInitialization,
): CandidateFileBlocker | undefined {
  if (!context.isUninitialized(cell.file)) {
    return undefined;
  }
  if (birth.status === 'invalid') {
    return createCandidateFileBlocker(
      'INVALID_FILE_VALUE',
      role,
      reference,
      birth.message,
    );
  }
  if (birth.status === 'absent') {
    return createCandidateFileBlocker(
      'UNINITIALIZED_FILE_VALUE',
      role,
      reference,
      'No successful schema projection proves this file slot source.',
    );
  }
  const error = initializeCandidateFile(row, reference, cell, birth.fileId);
  return error
    ? createCandidateFileBlocker('INVALID_FILE_VALUE', role, reference, error)
    : undefined;
}
