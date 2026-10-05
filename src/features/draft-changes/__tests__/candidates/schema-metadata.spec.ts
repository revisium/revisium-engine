import {
  calculateCandidate,
  candidateSchemaRowIdentity,
  candidateRowIntegrity,
  candidateTableSchema,
  CANDIDATE_ROW_ID,
  givenCreatedTablesWithPublicIdCollision,
  givenSelectedCandidate,
  rowLifecycle,
  schemaFields,
  schemaWith,
} from './support/candidate-scenario';
import { CATALOGUE_TABLE_CREATED_ID } from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import { metaSchema } from 'src/features/share/schema/meta-schema';
import objectHash from 'object-hash';
import {
  addField,
  numberField,
  rowInput,
  stringField,
  givenSchemaPatchGroups,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

describe('draft changes candidate schema metadata', () => {
  it('keeps the schema row validation-schema hash when its contents change', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const added = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: schemaFields('products', ['/properties/extra']),
      scenario: {
        headSchema,
        draftSchema: added.terminalSchema,
        pending: added.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Draft', extra: 2 })],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateSchemaRowIdentity(result, 'head', CATALOGUE_TABLE_CREATED_ID)
        .schemaHash,
    ).toBe(objectHash(metaSchema));
  });

  it('publishes a created row with the resulting Head schema hash', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const described = givenSchemaPatchGroups(headSchema, [
      [
        {
          op: 'replace',
          path: '/properties/title',
          value: { ...stringField(), description: 'Draft' },
        },
      ],
    ]);
    const { data } = await givenSelectedCandidate({
      operation: 'commit',
      selection: rowLifecycle('products', ['new-row']),
      scenario: {
        headSchema,
        draftSchema: described.terminalSchema,
        pending: described.steps,
        headRows: [rowInput(CANDIDATE_ROW_ID, { title: 'Head' })],
        draftRowSchemaHashes: {
          'new-row': objectHash(described.terminalSchema),
        },
        draftRows: [
          rowInput(CANDIDATE_ROW_ID, { title: 'Head' }),
          rowInput('new-row', { title: 'New' }),
        ],
      },
    });

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateRowIntegrity(
        result,
        'head',
        CATALOGUE_TABLE_CREATED_ID,
        'new-row',
      ).schemaHash,
    ).toBe(
      objectHash(
        candidateTableSchema(result, 'head', CATALOGUE_TABLE_CREATED_ID),
      ),
    );
    expect(
      candidateRowIntegrity(
        result,
        'draft',
        CATALOGUE_TABLE_CREATED_ID,
        'new-row',
      ).schemaHash,
    ).toBe(
      objectHash(
        candidateTableSchema(result, 'draft', CATALOGUE_TABLE_CREATED_ID),
      ),
    );
  });

  it('uses a created table public ID when refreshing its new row schema hash', async () => {
    const { data, tableCreatedId, tableSchema } =
      await givenCreatedTablesWithPublicIdCollision();

    const result = await calculateCandidate(data);

    expect(result.status).toBe('calculated');
    expect(
      candidateRowIntegrity(result, 'head', tableCreatedId, CANDIDATE_ROW_ID)
        .schemaHash,
    ).toBe(objectHash(tableSchema));
  });
});
