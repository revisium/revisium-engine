import {
  candidateData,
  candidateSchema,
  candidateState,
  createFormulaCandidateOperation,
  formulaField,
  requireRecomputed,
} from './support/formula-candidate';
import type { JsonValue } from 'src/engine-prisma-types';

describe('Draft Changes candidate formulas: evaluation', () => {
  let operation: Awaited<ReturnType<typeof createFormulaCandidateOperation>>;

  beforeAll(async () => {
    operation = await createFormulaCandidateOperation();
  });

  afterAll(async () => operation.close());

  it('recomputes Head and remaining Draft independently', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      quantity: { type: 'number', default: 1 },
      total: formulaField('number', 'price * quantity', 0),
    });
    expect(operation.validateMetaSchema(schema)).toBe(true);
    const head = candidateState({
      schema,
      data: { price: 5, quantity: 3, total: 0 },
    });
    const draft = candidateState({
      schema,
      data: { price: 5, quantity: 4, total: 0 },
    });

    const result = await operation.recompute({ head, draft });

    expect(result).toMatchObject({ status: 'recomputed' });
    expect(candidateData(result, 'head')).toEqual({
      price: 5,
      quantity: 3,
      total: 15,
    });
    expect(candidateData(result, 'draft')).toEqual({
      price: 5,
      quantity: 4,
      total: 20,
    });
  });

  it('uses each role schema when a formula changes between candidates', async () => {
    const head = candidateState({
      schema: candidateSchema({
        price: { type: 'number', default: 0 },
        total: formulaField('number', 'price * 2', 0),
      }),
      data: { price: 7, total: 0 },
    });
    const draft = candidateState({
      schema: candidateSchema({
        price: { type: 'number', default: 0 },
        total: formulaField('number', 'price * 3', 0),
      }),
      data: { price: 7, total: 0 },
    });

    const result = await operation.recompute({ head, draft });

    expect(candidateData(result, 'head')).toMatchObject({ total: 14 });
    expect(candidateData(result, 'draft')).toMatchObject({ total: 21 });
  });

  it('reports formula errors while exposing the toolkit default value', async () => {
    const schema = candidateSchema(
      {
        value: { type: 'string', default: '' },
        label: formulaField('string', 'value', 'fallback'),
      },
      ['label'],
    );
    const state = candidateState({ schema, data: {} });

    const result = await operation.recompute({ head: state, draft: state });

    const calculated = requireRecomputed(result);
    expect(calculated.formulaErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'head',
          tableCreatedId: 'products-created',
          rowCreatedId: 'product-row-created',
          path: '/label',
          expression: 'value',
          error: 'Formula returned undefined',
          defaultUsed: true,
        }),
      ]),
    );
    expect(candidateData(result, 'head')).toMatchObject({ label: '' });
    expect(candidateData(result, 'head')).not.toHaveProperty('value');
  });

  it('recomputes nested array formulas at concrete row paths', async () => {
    const schema = candidateSchema({
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            price: { type: 'number', default: 0 },
            count: { type: 'number', default: 1 },
            total: formulaField('number', 'price * count', 0),
          },
          required: ['price', 'count', 'total'],
          additionalProperties: false,
        },
      },
    });
    expect(operation.validateMetaSchema(schema)).toBe(true);
    const state = candidateState({
      schema,
      data: {
        items: [
          { price: 3, count: 2, total: 0 },
          { price: 4, count: 3, total: 0 },
        ],
      },
    });

    const result = await operation.recompute({ head: state, draft: state });

    expect(candidateData(result, 'draft')).toEqual({
      items: [
        { price: 3, count: 2, total: 6 },
        { price: 4, count: 3, total: 12 },
      ],
    });
    expect(requireRecomputed(result).effects).toEqual(
      expect.arrayContaining([
        {
          role: 'head',
          tableCreatedId: 'products-created',
          rowCreatedId: 'product-row-created',
          path: '/items/0/total',
          beforeExists: true,
          before: 0,
          afterExists: true,
          after: 6,
        },
        {
          role: 'draft',
          tableCreatedId: 'products-created',
          rowCreatedId: 'product-row-created',
          path: '/items/0/total',
          beforeExists: true,
          before: 0,
          afterExists: true,
          after: 6,
        },
        {
          role: 'head',
          tableCreatedId: 'products-created',
          rowCreatedId: 'product-row-created',
          path: '/items/1/total',
          beforeExists: true,
          before: 0,
          afterExists: true,
          after: 12,
        },
        {
          role: 'draft',
          tableCreatedId: 'products-created',
          rowCreatedId: 'product-row-created',
          path: '/items/1/total',
          beforeExists: true,
          before: 0,
          afterExists: true,
          after: 12,
        },
      ]),
    );
  });

  it('evaluates chained formulas in dependency order', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      subtotal: formulaField('number', 'price', 0),
      tax: formulaField('number', 'subtotal * 0.1', 0),
      total: formulaField('number', 'subtotal + tax', 0),
    });
    const state = candidateState({
      schema,
      data: { price: 100, subtotal: 0, tax: 0, total: 0 },
    });

    const result = await operation.recompute({ head: state, draft: state });

    expect(candidateData(result, 'head')).toEqual({
      price: 100,
      subtotal: 100,
      tax: 10,
      total: 110,
    });
    expect(result).toMatchObject({
      effects: expect.arrayContaining([
        expect.objectContaining({ path: '/subtotal', after: 100 }),
        expect.objectContaining({ path: '/tax', after: 10 }),
        expect.objectContaining({ path: '/total', after: 110 }),
      ]),
    });
  });

  it('leaves a candidate unchanged when there are no formulas', async () => {
    const state = candidateState({
      schema: candidateSchema({ title: { type: 'string', default: '' } }),
      data: { title: 'User value' },
    });

    const result = await operation.recompute({ head: state, draft: state });

    expect(candidateData(result, 'head')).toEqual({ title: 'User value' });
    expect(result).toMatchObject({ effects: [], formulaErrors: [] });
  });

  it('keeps invalid editable input blocked beside a valid formula output', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      total: formulaField('number', 'price * 2', 0),
    });
    const validHead = candidateState({
      schema,
      data: { price: 4, total: 8 },
    });
    const invalidDraft = candidateState({
      schema,
      data: { price: 'bad', total: 0 },
      rowCreatedId: 'draft-row-created',
    });

    const result = await operation.recompute({
      head: validHead,
      draft: invalidDraft,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'INVALID_RESULT_DATA',
          role: 'draft',
          path: '/price',
        }),
      ],
    });
  });

  it('keeps inputs detached from calculated results', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      total: formulaField('number', 'price * 2', 0),
      nested: {
        type: 'object',
        properties: { note: { type: 'string', default: '' } },
        required: ['note'],
        additionalProperties: false,
      },
    });
    expect(operation.validateMetaSchema(schema)).toBe(true);
    const head = candidateState({
      schema,
      data: { price: 4, total: 0, nested: { note: 'Head' } } as JsonValue,
    });
    const before = structuredClone({ head });

    const result = await operation.recompute({
      head,
      draft: structuredClone(head),
    });

    expect(head).toEqual(before.head);
    const output = requireRecomputed(result);
    operation.mutateNestedNote(output, 'head', 'Changed result');
    expect(head).toEqual(before.head);
  });
});
