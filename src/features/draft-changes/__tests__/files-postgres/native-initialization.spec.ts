import { createNativeFileInitializationScenario } from './support/native-initialization-scenario';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';

describe('Draft Changes files: native initialization', () => {
  it('prepares a native ADD with its existing ready file ID and no blob', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const projected = await scenario.projectSchemaAndCandidates(
        '/properties/attachment',
      );
      expect(projected.dependencies?.status).toBe('resolved');
      const prepared = await scenario.prepareCandidateFiles(
        projected.snapshot,
        requireResolved(projected.dependencies),
      );

      expect(ready.value).toMatchObject({ status: 'ready', hash: '', size: 0 });
      expect(ready.value.fileId).toMatch(/^[A-Za-z0-9_-]{21}$/);
      expect(ready.row.fileBlobs).toHaveLength(0);
      expect(scenario.storage.uploadFile).not.toHaveBeenCalled();
      expect(prepared).toMatchObject({
        status: 'prepared',
        effects: [
          expect.objectContaining({
            role: 'head',
            path: '/attachment',
            initializedFileId: ready.value.fileId,
          }),
        ],
        cleanupBlobIds: [],
      });
      if (prepared.status === 'prepared') {
        expect(readCandidateFile(prepared.head, 'attachment')).toMatchObject({
          status: 'ready',
          fileId: ready.value.fileId,
          hash: '',
          size: 0,
        });
      }
    } finally {
      await scenario.close();
    }
  });

  it('does not expose the native ready initialization as a selectable row edit', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      await scenario.addAttachment();
      const projected = await scenario.projectSchemaAndCandidates(
        '/properties/attachment',
      );
      expect(
        projected.catalogue?.entries.filter(
          ({ target }) =>
            target.kind === 'rowField' && target.path === '/attachment',
        ),
      ).toEqual([]);
    } finally {
      await scenario.close();
    }
  });

  it('keeps a later upload on the Draft candidate without copying it to Head', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const uploaded = await scenario.uploadAttachment(
        String(ready.value.fileId),
      );
      const projected = await scenario.projectSchemaAndCandidates(
        '/properties/attachment',
      );
      expect(projected.dependencies?.status).toBe('resolved');
      expect(
        projected.catalogue?.entries.find(
          ({ target }) =>
            target.kind === 'rowField' && target.path === '/attachment',
        ),
      ).toMatchObject({ classification: 'atomic', selectable: true });
      const prepared = await scenario.prepareCandidateFiles(
        projected.snapshot,
        requireResolved(projected.dependencies),
      );

      expect(uploaded.value.fileId).toBe(ready.value.fileId);
      expect(uploaded.value.status).toBe('uploaded');
      expect(uploaded.row.fileBlobs).toHaveLength(1);
      expect(scenario.storage.uploadFile).toHaveBeenCalledTimes(1);
      expect(prepared).toMatchObject({ status: 'prepared' });
      if (prepared.status === 'prepared') {
        expect(readCandidateFile(prepared.head, 'attachment')).toMatchObject({
          status: 'ready',
          fileId: ready.value.fileId,
          hash: '',
          size: 0,
        });
        expect(readCandidateFile(prepared.draft, 'attachment')).toMatchObject({
          status: 'uploaded',
          fileId: ready.value.fileId,
          hash: uploaded.value.hash,
          size: uploaded.value.size,
        });
        expect(readCandidateBlobIds(prepared.head)).toEqual([]);
        expect(readCandidateBlobIds(prepared.draft)).toEqual(
          uploaded.row.fileBlobs.map(({ id }) => id),
        );
      }
    } finally {
      await scenario.close();
    }
  });

  it('discards an upload while retaining its pending File ADD', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const uploaded = await scenario.uploadAttachment(
        String(ready.value.fileId),
      );
      const discarded =
        await scenario.discardCandidatesAtRowPath('/attachment');
      const dependencies = requireResolved(discarded.dependencies);
      expect(dependencies.schemaProjectionBindings).toEqual([
        expect.objectContaining({ operation: 'discard', selectedEffects: [] }),
      ]);

      const prepared = await scenario.prepareCandidateFiles(
        discarded.snapshot,
        dependencies,
      );

      expect(prepared.status).toBe('prepared');
      if (prepared.status === 'prepared') {
        expect(
          readCandidateDataField(prepared.head, 'attachment'),
        ).toBeUndefined();
        expect(readCandidateFile(prepared.draft, 'attachment')).toEqual(
          ready.value,
        );
        expect(readCandidateBlobIds(prepared.draft)).toEqual([]);
        expect(prepared.cleanupBlobIds).toEqual(
          uploaded.row.fileBlobs.map(({ id }) => id),
        );
        expect(prepared.effects).toContainEqual(
          expect.objectContaining({
            role: 'draft',
            path: '/attachment',
            initializedFileId: ready.value.fileId,
          }),
        );
      }
    } finally {
      await scenario.close();
    }
  });

  it('carries genuine ADD and MOVE source lineage through candidate projection', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const moved = await scenario.moveAttachment();
      const projected =
        await scenario.projectSchemaAndCandidates('/properties/asset');
      const addOnly = await scenario.projectNativeAddOnly();

      expect(moved.value.fileId).toBe(ready.value.fileId);
      expect(moved.value.status).toBe('ready');
      expect(addOnly.projection).toMatchObject({
        status: 'projected',
        selectedEffects: [addOnly.effect],
        rowTargetFieldMappings: expect.arrayContaining([
          { fromPath: '/asset', toPath: '/attachment' },
        ]),
        fileSlots: expect.arrayContaining([
          {
            role: 'head',
            introducedBy: addOnly.effect,
            sourceDraftPath: '/asset',
            projectedPath: '/attachment',
          },
        ]),
      });
      expect(projected.dependencies?.status).toBe('resolved');
      expect(projected.dependencies).toMatchObject({
        schemaProjectionBindings: [
          expect.objectContaining({
            sourceFingerprint: expect.any(String),
            operation: 'commit',
            selectedEffects: [
              { historyIndex: 1, patchIndex: 0 },
              { historyIndex: 2, patchIndex: 0 },
            ],
            fileSlots: expect.arrayContaining([
              {
                role: 'head',
                introducedBy: { historyIndex: 1, patchIndex: 0 },
                sourceDraftPath: '/asset',
                projectedPath: '/asset',
              },
            ]),
          }),
        ],
      });
    } finally {
      await scenario.close();
    }
  });

  it('uses persisted ADD source lineage to initialize a moved Head file slot', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      await scenario.moveAttachment();
      const prepared = await scenario.prepareMovedAddOnlySlot();

      expect(readCandidateFile(prepared.head, 'attachment')).toMatchObject({
        ...ready.value,
        status: 'ready',
        fileId: ready.value.fileId,
      });
      expect(readCandidateFile(prepared.draft, 'asset')).toEqual(ready.value);
      expect(prepared.effects).toEqual([
        expect.objectContaining({
          role: 'head',
          path: '/attachment',
          initializedFileId: ready.value.fileId,
        }),
      ]);
      expect(readCandidateBlobIds(prepared.head)).toEqual([]);
      expect(readCandidateBlobIds(prepared.draft)).toEqual([]);
      expect(prepared.cleanupBlobIds).toEqual([]);
      expect(scenario.storage.uploadFile).not.toHaveBeenCalled();
    } finally {
      await scenario.close();
    }
  });

  it('forwards compact source context and effective refs to resolved candidates', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      await scenario.addAttachment();
      await scenario.moveAttachment();
      const projected =
        await scenario.projectSchemaAndCandidates('/properties/asset');
      expect(projected.dependencies?.status).toBe('resolved');
      expect(projected.dependencies).toMatchObject({
        effectiveRefs: expect.arrayContaining([
          expect.objectContaining({ value: expect.any(String) }),
        ]),
        schemaProjectionBindings: [
          expect.objectContaining({
            sourceFingerprint: expect.any(String),
            operation: 'commit',
            selectedEffects: [
              { historyIndex: 1, patchIndex: 0 },
              { historyIndex: 2, patchIndex: 0 },
            ],
          }),
        ],
      });
    } finally {
      await scenario.close();
    }
  });

  it('restores a moved uploaded file from Head during an actual discard', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      const ready = await scenario.addAttachment();
      const headUpload = await scenario.uploadAttachment(
        String(ready.value.fileId),
      );
      const headBlob = headUpload.row.fileBlobs[0];
      if (!headBlob) {
        throw new Error('Expected the Head upload blob.');
      }
      await scenario.promoteCurrentDraftToHead();
      await scenario.moveAttachment();
      const draftUpload = await scenario.uploadFileAtPath(
        String(ready.value.fileId),
        'asset',
        'different proof bytes',
      );
      const draftBlob = draftUpload.row.fileBlobs[0];
      if (!draftBlob) {
        throw new Error('Expected the Draft upload blob.');
      }
      expect(draftUpload.value.fileId).toBe(ready.value.fileId);
      expect(draftBlob.id).not.toBe(headBlob.id);

      const discarded = await scenario.discardCandidatesAtRowPath('/asset');
      expect(discarded.dependencies.status).toBe('resolved');
      if (discarded.dependencies.status !== 'resolved') {
        throw new Error('Expected discard dependencies to resolve.');
      }
      const prepared = await scenario.changes.prepareCandidateFiles({
        snapshot: discarded.snapshot,
        head: discarded.dependencies.head,
        draft: discarded.dependencies.draft,
        schemaProjectionBindings:
          discarded.dependencies.schemaProjectionBindings,
      });

      expect(prepared.status).toBe('prepared');
      if (prepared.status === 'prepared') {
        expect(readCandidateFile(prepared.draft, 'asset')).toMatchObject({
          status: 'uploaded',
          fileId: ready.value.fileId,
          hash: headUpload.value.hash,
        });
        expect(readCandidateBlobIds(prepared.draft)).toEqual([headBlob.id]);
        expect(prepared.cleanupBlobIds).toContain(draftBlob.id);
      }
    } finally {
      await scenario.close();
    }
  });

  it('initializes file slots before recomputing formulas that read file status', async () => {
    const scenario = await createNativeFileInitializationScenario();
    try {
      await scenario.addAttachmentStatusFormula();
      const projected = await scenario.projectSchemaAndCandidates([
        '/properties/attachment',
        '/properties/fileStatus',
      ]);
      const prepared = await scenario.prepareCandidateFiles(
        projected.snapshot,
        requireResolved(projected.dependencies),
      );
      expect(prepared.status).toBe('prepared');
      if (prepared.status !== 'prepared') {
        throw new Error('Expected candidate file preparation.');
      }

      const formulaResult = await scenario.changes.recomputeCandidateFormulas({
        head: prepared.head,
        draft: prepared.draft,
      });

      expect(formulaResult.status).toBe('recomputed');
      if (formulaResult.status === 'recomputed') {
        expect(readCandidateDataField(formulaResult.head, 'fileStatus')).toBe(
          'ready',
        );
        expect(readCandidateDataField(formulaResult.draft, 'fileStatus')).toBe(
          'ready',
        );
      }
    } finally {
      await scenario.close();
    }
  });
});

function readCandidateFile(
  state: {
    tables: Array<{ id: string; rows: Array<{ id: string; data: unknown }> }>;
  },
  field: string,
): Record<string, unknown> {
  const table = state.tables.find(({ id }) => id === 'documents');
  const row = table?.rows.find(({ id }) => id === 'document');
  const value = (row?.data as Record<string, unknown> | undefined)?.[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected file value at ${field}.`);
  }
  return value as Record<string, unknown>;
}

function readCandidateDataField(
  state: {
    tables: Array<{ id: string; rows: Array<{ id: string; data: unknown }> }>;
  },
  field: string,
): unknown {
  const table = state.tables.find(({ id }) => id === 'documents');
  const row = table?.rows.find(({ id }) => id === 'document');
  return (row?.data as Record<string, unknown> | undefined)?.[field];
}

function readCandidateBlobIds(state: {
  tables: Array<{
    id: string;
    rows: Array<{ id: string; fileBlobs?: Array<{ id: string }> }>;
  }>;
}): string[] {
  const table = state.tables.find(({ id }) => id === 'documents');
  const row = table?.rows.find(({ id }) => id === 'document');
  return row?.fileBlobs?.map(({ id }) => id) ?? [];
}

function requireResolved(
  result: ResolveCandidateDependenciesResult | undefined,
): Extract<ResolveCandidateDependenciesResult, { status: 'resolved' }> {
  if (!result || result.status !== 'resolved') {
    throw new Error('Expected resolved candidate dependencies.');
  }
  return result;
}
