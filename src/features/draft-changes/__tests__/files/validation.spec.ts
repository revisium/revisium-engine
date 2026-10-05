import {
  blob,
  blobIds,
  givenFileCandidate,
  preparedRow,
  readyFile,
  requireBlocked,
  requirePrepared,
  uploadedFile,
} from './support/file-candidate-scenario';
import type { FileValue } from './support/file-candidate-scenario';
import {
  getArraySchema,
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type {
  JsonObjectSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';

describe('candidate files: validation', () => {
  it.each([
    ['fileId', 'B'.repeat(21)],
    ['hash', 'f'.repeat(64)],
    ['size', 99],
  ] as const)('rejects a changed immutable %s', async (key, value) => {
    const sourceBlob = blob('source-blob', 'a'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const scenario = givenFileCandidate({
      head: { value: source, blobs: [sourceBlob] },
      draft: { value: source, blobs: [sourceBlob] },
    });
    scenario.setFile('draft', { ...source, [key]: value });

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FILE_VALUE',
        role: 'draft',
        path: '/file',
      }),
    );
  });

  it('accepts a ready file with no uploaded blob association', async () => {
    const scenario = givenFileCandidate({
      head: { value: readyFile() },
      draft: { value: readyFile() },
    });

    const prepared = requirePrepared(await scenario.prepare());

    expect(prepared.effects).toEqual([]);
    expect(prepared.cleanupBlobIds).toEqual([]);
  });

  it.each(['ready', 'error'] as const)(
    'rejects an %s file ID replacement even when the replacement is native-shaped',
    async (status) => {
      const scenario = givenFileCandidate({
        head: { value: readyFile({ status }) },
        draft: { value: readyFile({ status }) },
      });
      scenario.setFile('draft', readyFile({ status, fileId: 'B'.repeat(21) }));

      const blocked = requireBlocked(await scenario.prepare());

      expect(blocked.blockers).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_FILE_VALUE',
          role: 'draft',
          path: '/file',
        }),
      );
    },
  );

  it('does not let an invalid same-ID source tuple authorize a ready candidate', async () => {
    const candidate = readyFile();
    const invalidSource: Record<string, unknown> = { ...candidate };
    delete invalidSource.fileName;
    const scenario = givenFileCandidate({
      head: { value: candidate },
      draft: { value: candidate },
    });
    scenario.setSourceFile('head', invalidSource);
    scenario.setSourceFile('draft', invalidSource);

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FILE_VALUE',
        role: 'head',
        path: '/file',
      }),
    );
  });

  it('rejects a canonical blob owned by another project', async () => {
    const sourceBlob = blob('foreign-blob', 'b'.repeat(64));
    const scenario = givenFileCandidate({
      head: {
        value: uploadedFile({ hash: sourceBlob.hash }),
        blobs: [sourceBlob],
      },
      draft: {
        value: uploadedFile({ hash: sourceBlob.hash }),
        blobs: [sourceBlob],
      },
    });
    scenario.setSourceBlobProject('head', 'foreign-blob', 'another-project');
    scenario.setSourceBlobProject('draft', 'foreign-blob', 'another-project');

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'FILE_BLOB_MISMATCH',
        role: 'head',
        path: '/file',
      }),
    );
  });

  it('rejects a raw file value with missing required metadata before normalization', async () => {
    const sourceBlob = blob('source-blob', 'c'.repeat(64));
    const value = uploadedFile({ hash: sourceBlob.hash });
    const scenario = givenFileCandidate({
      head: { value, blobs: [sourceBlob] },
      draft: { value, blobs: [sourceBlob] },
    });
    const incomplete: Partial<FileValue> = { ...value };
    delete incomplete.fileName;
    scenario.setFile('draft', incomplete);

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FILE_VALUE',
        role: 'draft',
        path: '/file',
      }),
    );
  });

  it('rejects an uploaded tuple without its source blob association', async () => {
    const sourceBlob = blob('source-blob', 'd'.repeat(64));
    const value = uploadedFile({ hash: sourceBlob.hash });
    const scenario = givenFileCandidate({
      head: { value, blobs: [sourceBlob] },
      draft: { value, blobs: [sourceBlob] },
    });
    scenario.clearSourceBlobAssociations('head');
    scenario.clearSourceBlobAssociations('draft');

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'FILE_SOURCE_NOT_FOUND',
        role: 'draft',
        path: '/file',
      }),
    );
  });

  it('validates an unchanged file nested under object properties', async () => {
    const sourceBlob = blob('nested-blob', 'e'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const schema = getObjectSchema({
      caption: getStringSchema(),
      media: getObjectSchema({ thumbnail: getRefSchema(SystemSchemaIds.File) }),
    }) as JsonObjectSchema;
    const scenario = givenStructuredCandidate(
      schema,
      { caption: 'unchanged', media: { thumbnail: source } },
      source,
      sourceBlob,
    );

    const prepared = requirePrepared(await scenario.prepare());

    for (const role of ['head', 'draft'] as const) {
      const row = preparedRow(prepared[role], role);
      expect(row.data).toEqual({
        caption: 'unchanged',
        media: { thumbnail: source },
      });
      expect(blobIds(row)).toEqual([sourceBlob.id]);
    }
    expect(prepared.cleanupBlobIds).not.toContain(sourceBlob.id);
  });

  it('rejects a schema-valid but natively invalid nested file ID at its data pointer', async () => {
    const sourceBlob = blob('nested-invalid-blob', '3'.repeat(64));
    const source = uploadedFile({
      fileId: 'invalid',
      hash: sourceBlob.hash,
    });
    const schema = getObjectSchema({
      caption: getStringSchema(),
      media: getObjectSchema({ thumbnail: getRefSchema(SystemSchemaIds.File) }),
    }) as JsonObjectSchema;
    const scenario = givenStructuredCandidate(
      schema,
      { caption: 'unchanged', media: { thumbnail: source } },
      source,
      sourceBlob,
    );

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FILE_VALUE',
        role: 'head',
        path: '/media/thumbnail',
      }),
    );
  });

  it('validates each concrete file value in a nonempty array', async () => {
    const sourceBlob = blob('array-blob', 'f'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const schema = getObjectSchema({
      caption: getStringSchema(),
      attachments: getArraySchema(getRefSchema(SystemSchemaIds.File)),
    }) as JsonObjectSchema;
    const scenario = givenStructuredCandidate(
      schema,
      { caption: 'unchanged', attachments: [source] },
      source,
      sourceBlob,
    );

    const prepared = requirePrepared(await scenario.prepare());

    for (const role of ['head', 'draft'] as const) {
      const row = preparedRow(prepared[role], role);
      expect(row.data).toEqual({
        caption: 'unchanged',
        attachments: [source],
      });
      expect(blobIds(row)).toEqual([sourceBlob.id]);
    }
    expect(prepared.cleanupBlobIds).not.toContain(sourceBlob.id);
  });

  it('rejects a schema-valid but natively invalid array file ID at its occurrence pointer', async () => {
    const sourceBlob = blob('array-invalid-blob', '4'.repeat(64));
    const source = uploadedFile({
      fileId: 'invalid',
      hash: sourceBlob.hash,
    });
    const schema = getObjectSchema({
      caption: getStringSchema(),
      attachments: getArraySchema(getRefSchema(SystemSchemaIds.File)),
    }) as JsonObjectSchema;
    const scenario = givenStructuredCandidate(
      schema,
      { caption: 'unchanged', attachments: [source] },
      source,
      sourceBlob,
    );

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FILE_VALUE',
        role: 'head',
        path: '/attachments/0',
      }),
    );
  });

  it('rejects omission of a required File cell', async () => {
    const sourceBlob = blob('required-file-blob', '5'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const schema = getObjectSchema({
      caption: getStringSchema(),
      attachment: getRefSchema(SystemSchemaIds.File),
    }) as JsonObjectSchema;
    const scenario = givenStructuredCandidate(
      schema,
      { caption: 'unchanged' },
      source,
      sourceBlob,
      [],
    );

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FILE_VALUE',
        role: 'head',
        path: '/attachment',
      }),
    );
  });

  it('preserves an absent optional File cell', async () => {
    const source = uploadedFile();
    const schema: JsonObjectSchema = {
      type: 'object',
      properties: {
        caption: getStringSchema(),
        attachment: getRefSchema(SystemSchemaIds.File),
      },
      required: ['caption'],
      additionalProperties: false,
    };
    const scenario = givenStructuredCandidate(
      schema,
      { caption: 'unchanged' },
      source,
      blob('optional-file-unused', source.hash),
      [],
    );

    const prepared = requirePrepared(await scenario.prepare());

    expect(preparedRow(prepared.head, 'head').data).toEqual({
      caption: 'unchanged',
    });
    expect(preparedRow(prepared.draft, 'draft').data).toEqual({
      caption: 'unchanged',
    });
    expect(prepared.cleanupBlobIds).toEqual([]);
  });

  it.each(['ready', 'error'] as const)(
    'rejects an %s value whose same-ID source size changed from zero',
    async (status) => {
      const source = readyFile({ status, size: 0 });
      const scenario = givenFileCandidate({
        head: { value: source },
        draft: { value: source },
      });
      scenario.setFile('draft', { ...source, size: 1 });

      const blocked = requireBlocked(await scenario.prepare());

      expect(blocked.blockers).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_FILE_VALUE',
          role: 'draft',
          path: '/file',
        }),
      );
    },
  );

  it('accepts an empty array of file values without a phantom raw cell', async () => {
    const sourceBlob = blob('empty-array-source', '8'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const schema = getObjectSchema({
      caption: getStringSchema(),
      attachments: getArraySchema(getRefSchema(SystemSchemaIds.File)),
    }) as JsonObjectSchema;
    const scenario = givenStructuredCandidate(
      schema,
      { caption: 'unchanged', attachments: [] },
      source,
      sourceBlob,
      [],
    );

    const prepared = requirePrepared(await scenario.prepare());

    expect(prepared.cleanupBlobIds).toEqual([]);
  });

  it('clears stale blob associations when a surviving row has no file fields', async () => {
    const sourceBlob = blob('detached-file-blob', '9'.repeat(64));
    const source = uploadedFile({ hash: sourceBlob.hash });
    const scenario = givenFileCandidate({
      head: { value: source, blobs: [sourceBlob] },
      draft: { value: source, blobs: [sourceBlob] },
    });
    const schema = getObjectSchema({
      caption: getStringSchema(),
    }) as JsonObjectSchema;
    const data = { caption: 'row remains' } as unknown as JsonValue;
    for (const role of ['head', 'draft'] as const) {
      scenario.setCandidateDocument(role, schema, data, [sourceBlob.id]);
    }

    const prepared = requirePrepared(await scenario.prepare());

    for (const role of [prepared.head, prepared.draft]) {
      const row = role.tables
        .flatMap((table) => table.rows)
        .find(({ id }) => id === 'product-1');
      expect(row?.fileBlobs).toEqual([]);
    }
    expect(prepared.cleanupBlobIds).toEqual([sourceBlob.id]);
  });

  it('rejects file data whose size disagrees with the canonical blob', async () => {
    const sourceBlob = blob('source-blob', '2'.repeat(64), 12n);
    const source = uploadedFile({ hash: sourceBlob.hash, size: 13 });
    const scenario = givenFileCandidate({
      head: { value: source, blobs: [sourceBlob] },
      draft: { value: source, blobs: [sourceBlob] },
    });

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'FILE_BLOB_MISMATCH',
        role: 'head',
        path: '/file',
      }),
    );
  });

  it('rejects a non-object raw file value', async () => {
    const scenario = givenFileCandidate({
      head: { value: readyFile() },
      draft: { value: readyFile() },
    });
    scenario.setFile('draft', 'not-a-file-object');

    const blocked = requireBlocked(await scenario.prepare());

    expect(blocked.blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FILE_VALUE',
        role: 'draft',
        path: '/file',
      }),
    );
  });
});

function givenStructuredCandidate(
  schema: JsonObjectSchema,
  data: Record<string, unknown>,
  source: FileValue,
  sourceBlob: ReturnType<typeof blob>,
  blobIds = [sourceBlob.id],
) {
  const scenario = givenFileCandidate({
    head: { value: source, blobs: [sourceBlob] },
    draft: { value: source, blobs: [sourceBlob] },
  });
  for (const role of ['head', 'draft'] as const) {
    scenario.setCandidateDocument(
      role,
      schema,
      data as unknown as JsonValue,
      blobIds,
      true,
    );
  }
  return scenario;
}
