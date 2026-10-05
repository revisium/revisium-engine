import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  corruptDraftSchemaHistoryHash,
  givenRestoreHeadCandidate,
  schemaWith,
} from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import {
  arraySchema,
  objectSchema,
  rowInput,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import {
  givenForeignKeyRestoreHead,
  givenLinkedTargetCandidate,
  resolveDependencies,
} from './support/dependency-scenario';
import { givenUnparseableDraftWithBlockedDiagnostics } from './support/reference-diagnostic-scenario';
import {
  requireDependencyBlocker,
  requireResolvedDependencies,
} from './support/dependency-results';
import { calculatedResult } from 'src/features/draft-changes/dependencies/candidate-calculation';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';

describe('draft changes candidate dependency integrity', () => {
  it('blocks a reference whose target table is missing from both original roles', async () => {
    const schema = schemaWith({
      parentId: {
        type: 'string',
        default: '',
        foreignKey: 'missing-target',
      },
    });
    const data = await givenRestoreHeadCandidate({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput('row-product', { parentId: 'target-row' })],
    });

    const result = await resolveDependencies(data);

    expect(
      requireDependencyBlocker(result, 'MISSING_REFERENCE_TARGET', {
        rowCreatedId: 'row-product',
      }),
    ).toMatchObject({
      role: 'head',
      tableCreatedId: 'stable-products',
      rowCreatedId: 'row-product',
      path: '/parentId',
      targetTableId: 'missing-target',
      targetRowId: 'target-row',
    });
  });

  it('treats an existing empty-string row ID as a real FK target', async () => {
    const data = await givenForeignKeyRestoreHead('');

    const result = await resolveDependencies(data);

    expect(requireResolvedDependencies(result).automatic).toEqual([]);
  });

  it('checks an FK schema even when the referencing table has no rows', async () => {
    const schema = schemaWith({
      parentId: {
        type: 'string',
        default: '',
        foreignKey: 'missing-target',
      },
    });
    const data = await givenRestoreHeadCandidate({
      headSchema: schema,
      draftSchema: schema,
      headRows: [],
      draftRows: [],
    });

    const result = await resolveDependencies(data);

    expect(
      requireDependencyBlocker(result, 'MISSING_REFERENCE_TARGET'),
    ).toMatchObject({
      role: 'head',
      tableCreatedId: 'stable-products',
      path: '/properties/parentId',
      targetTableId: 'missing-target',
    });
  });

  it('reports a nested array reference at its escaped data pointer', async () => {
    const schema = schemaWith({
      groups: arraySchema(
        objectSchema({
          parentId: {
            type: 'string',
            default: '',
            foreignKey: 'missing-target',
          },
        }),
      ),
    });
    const data = await givenRestoreHeadCandidate({
      headSchema: schema,
      draftSchema: schema,
      headRows: [
        rowInput('row-product', { groups: [{ parentId: 'missing-row' }] }),
      ],
    });

    const result = await resolveDependencies(data);

    expect(
      requireDependencyBlocker(result, 'MISSING_REFERENCE_TARGET', {
        rowCreatedId: 'row-product',
      }),
    ).toMatchObject({
      role: 'head',
      rowCreatedId: 'row-product',
      path: '/groups/0/parentId',
      targetTableId: 'missing-target',
      targetRowId: 'missing-row',
    });
  });

  it('uses the empty JSON Pointer for a root FK reference', async () => {
    const schema: JsonSchema = {
      type: 'string',
      default: '',
      foreignKey: 'missing-target',
    };
    const data = await givenRestoreHeadCandidate({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput('row-product', 'missing-row')],
    });

    const result = await resolveDependencies(data);

    expect(
      requireDependencyBlocker(result, 'MISSING_REFERENCE_TARGET', {
        rowCreatedId: 'row-product',
      }),
    ).toMatchObject({
      role: 'head',
      tableCreatedId: 'stable-products',
      rowCreatedId: 'row-product',
      path: '',
      targetRowId: 'missing-row',
    });
  });

  it('checks a missing FK introduced by a schema default', async () => {
    const scenario = await givenLinkedTargetCandidate({
      defaultReferenceField: true,
      targetRows: [],
    });

    const result = await resolveDependencies(scenario.data);

    expect(
      requireDependencyBlocker(result, 'MISSING_REFERENCE_TARGET', {
        rowCreatedId: 'source-row',
      }),
    ).toMatchObject({
      role: 'head',
      tableCreatedId: 'stable-products',
      rowCreatedId: 'source-row',
      path: '/link',
      targetTableId: 'secondary-products',
      targetRowId: '',
    });
  });

  it('restores Head without requiring invalid Draft schema history to replay', async () => {
    const data = await givenRestoreHeadCandidate();
    corruptDraftSchemaHistoryHash(data.snapshot);

    const result = await resolveDependencies(data);

    const resolved = requireResolvedDependencies(result);
    expect(resolved.head).toEqual(data.snapshot.head);
    expect(resolved.draft).toEqual(data.snapshot.head);
  });

  it('blocks restore Head when the restored Head graph has a missing target', async () => {
    const schema = schemaWith({
      parentId: {
        type: 'string',
        default: '',
        foreignKey: 'missing-target',
      },
    });
    const data = await givenRestoreHeadCandidate({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput('row-product', { parentId: 'missing-row' })],
      draftRows: [],
    });

    const result = await resolveDependencies(data);

    expect(
      requireDependencyBlocker(result, 'MISSING_REFERENCE_TARGET', {
        rowCreatedId: 'row-product',
      }),
    ).toMatchObject({
      role: 'head',
      rowCreatedId: 'row-product',
      path: '/parentId',
      targetTableId: 'missing-target',
      targetRowId: 'missing-row',
    });
  });

  it('preserves typed blockers when the source schema cannot be parsed for enrichment', async () => {
    const scenario = await givenUnparseableDraftWithBlockedDiagnostics();

    const result = calculatedResult(
      { status: 'blocked', blockers: scenario.blockers },
      scenario.data,
      new JsonSchemaStoreService(),
    );

    expect(result).toEqual({
      status: 'blocked',
      blockers: scenario.blockers,
    });
  });
});
