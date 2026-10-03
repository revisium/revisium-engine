import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { getRefSchema } from '@revisium/schema-toolkit/mocks';
import { pluginRefs } from '@revisium/schema-toolkit/lib';
import type { JsonObjectSchema } from '@revisium/schema-toolkit/types';
import {
  givenSchemaProjection,
  objectSchema,
  project,
  requiredArrayItem,
  requiredBlocked,
  requiredProjected,
  requiredProjectionBlocker,
  requiredProjectionRow,
  rowInput,
  stringField,
} from './support/schema-projection-fixture';

describe('Draft Changes schema projection snapshot behavior', () => {
  it('returns a blocker for null schema-row history metadata', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
    });
    requiredArrayItem(
      requiredArrayItem(input.snapshot.head.tables, 0, 'Head schema table')
        .rows,
      0,
      'Head schema row',
    ).meta = null;

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_HISTORY_INVALID',
    );
  });

  it('rejects extra patches in the root schema history entry', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
    });
    const headMeta = requiredArrayItem(
      requiredArrayItem(input.snapshot.head.tables, 0, 'Head schema table')
        .rows,
      0,
      'Head schema row',
    ).meta as Array<{ patches: Array<Record<string, unknown>> }>;
    headMeta[0]?.patches.push({ op: 'remove', path: '/properties/name' });
    const draftMeta = requiredArrayItem(
      requiredArrayItem(input.snapshot.draft.tables, 0, 'Draft schema table')
        .rows,
      0,
      'Draft schema row',
    ).meta as Array<{ patches: Array<Record<string, unknown>> }>;
    draftMeta[0]?.patches.push({ op: 'remove', path: '/properties/name' });

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_HISTORY_INVALID',
    );
  });

  it('rejects multiple schema tables for a revision', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
    });
    const schemaTable = requiredArrayItem(
      input.snapshot.head.tables,
      0,
      'Head schema table',
    );
    input.snapshot.head.tables.push(structuredClone(schemaTable));

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_IDENTITY_AMBIGUOUS',
    );
  });

  it('requires Head and Draft schema rows to share a stable created identity', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
    });
    requiredArrayItem(
      requiredArrayItem(input.snapshot.draft.tables, 0, 'Draft schema table')
        .rows,
      0,
      'Draft schema row',
    ).createdId = 'different-schema-row';

    const result = requiredBlocked(await project(input));

    expect(requiredProjectionBlocker(result).code).toBe(
      'SCHEMA_IDENTITY_MISSING',
    );
  });

  it('does not mutate the supplied snapshot, refs, metadata, or ordering', async () => {
    const schema = objectSchema({ name: stringField() });
    const refs = { ...pluginRefs };
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput('row-1', { name: 'one' })],
      draftRows: [
        rowInput('row-2', { name: 'second' }),
        rowInput('row-1', { name: 'first' }),
      ],
      schemaRefs: refs,
    });
    const draftTable = requiredArrayItem(
      input.snapshot.draft.tables,
      1,
      'Draft data table',
    );
    const draftRow = requiredArrayItem(draftTable.rows, 0, 'Draft row');
    draftRow.meta = { labels: ['second', 'first'] };
    draftRow.publishedAt = new Date('2026-02-03T04:05:06.000Z');
    const pristineSnapshot = structuredClone(input.snapshot);
    const pristineRefs = structuredClone(refs);

    await project(input);

    expect(input.snapshot).toEqual(pristineSnapshot);
    expect(refs).toEqual(pristineRefs);
    expect(draftTable.rows.map(({ createdId }) => createdId)).toEqual([
      'row-2',
      'row-1',
    ]);
  });

  it('returns detached schema and row values', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput('row-1', { name: 'head' })],
      draftRows: [rowInput('row-1', { name: 'draft' })],
    });

    const draftTable = requiredArrayItem(
      input.snapshot.draft.tables,
      1,
      'Draft data table',
    );
    const result = requiredProjected(await project(input));

    (result.head.schema as JsonObjectSchema).properties.name =
      stringField('changed output');
    requiredProjectionRow(result.draft, 'row-1').data = {
      name: 'changed output',
    };
    expect(
      requiredArrayItem(
        requiredArrayItem(input.snapshot.head.tables, 1, 'Head data table')
          .rows,
        0,
        'Head row',
      ).data,
    ).toEqual({
      name: 'head',
    });
    expect(requiredArrayItem(draftTable.rows, 0, 'Draft row').data).toEqual({
      name: 'draft',
    });
  });

  it('matches schemas by stable table identity across public table renames', async () => {
    const schema = objectSchema({ name: stringField() });
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headTableId: 'products-before-rename',
      draftTableId: 'products-after-rename',
    });

    const result = requiredProjected(await project(input));

    expect(result.head.schema).toEqual(schema);
    expect(result.draft.schema).toEqual(schema);
  });

  it('preserves existing plugin $ref schemas and values', async () => {
    const file = {
      status: 'available',
      fileId: 'file-1',
      url: '/files/file-1',
      fileName: 'draft-report.txt',
      hash: 'sha256:report',
      extension: 'txt',
      mimeType: 'text/plain',
      size: 12,
      width: 0,
      height: 0,
    };
    const fileSchema = getRefSchema(SystemSchemaIds.File);
    const headSchema = objectSchema({
      file: fileSchema,
      obsolete: stringField(),
    });
    const draftSchema = objectSchema({ file: fileSchema });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema,
      draftSchema,
      headRows: [
        rowInput('row-1', {
          file: { ...file, fileName: 'report.txt' },
          obsolete: 'head',
        }),
      ],
      draftRows: [rowInput('row-1', { file })],
      pending: [
        {
          patches: [{ op: 'remove', path: '/properties/obsolete' }],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
      schemaRefs: { ...pluginRefs },
    });

    const result = requiredProjected(await project(input));

    expect(result.draft.schema).toEqual(headSchema);
    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      file,
      obsolete: 'head',
    });
  });

  it('validates residual rows using caller-provided schema refs', async () => {
    const schema = objectSchema({
      name: { $ref: 'custom-name' },
      obsolete: stringField(),
    });
    const draftSchema = objectSchema({ name: { $ref: 'custom-name' } });
    const input = givenSchemaProjection({
      operation: 'discard',
      headSchema: schema,
      draftSchema,
      headRows: [rowInput('row-1', { name: 'Head', obsolete: 'old' })],
      draftRows: [rowInput('row-1', { name: 'Draft' })],
      pending: [
        {
          patches: [{ op: 'remove', path: '/properties/obsolete' }],
          schema: draftSchema,
        },
      ],
      selectedEffects: [{ historyIndex: 1, patchIndex: 0 }],
      schemaRefs: { 'custom-name': stringField() },
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.draft, 'row-1').data).toEqual({
      name: 'Draft',
      obsolete: 'old',
    });
  });

  it('preserves primitive row roots when their schema is primitive', async () => {
    const schema = stringField();
    const input = givenSchemaProjection({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput('row-1', 'Head value')],
      draftRows: [rowInput('row-1', 'Draft value')],
    });

    const result = requiredProjected(await project(input));

    expect(requiredProjectionRow(result.head, 'row-1').data).toBe('Head value');
    expect(requiredProjectionRow(result.draft, 'row-1').data).toBe(
      'Draft value',
    );
  });
});
