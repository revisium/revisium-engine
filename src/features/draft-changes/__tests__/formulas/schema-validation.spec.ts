import {
  candidateSchema,
  candidateState,
  createFormulaCandidateOperation,
  formulaField,
} from './support/formula-candidate';
import type { JsonValue } from 'src/engine-prisma-types';
import type { JsonSchema } from '@revisium/schema-toolkit/types';

describe('Draft Changes candidate formulas: schema validation', () => {
  let operation: Awaited<ReturnType<typeof createFormulaCandidateOperation>>;

  beforeAll(async () => {
    operation = await createFormulaCandidateOperation();
  });

  afterAll(async () => operation.close());

  it.each(invalidFormulaSchemas())(
    'blocks a $name formula schema',
    async ({ schema, data }) => {
      expect(operation.validateMetaSchema(schema)).toBe(true);
      const validSchema = candidateSchema({
        price: { type: 'number', default: 0 },
        total: formulaField('number', 'price * 2', 0),
      });
      const head = candidateState({
        schema: validSchema,
        data: { price: 3, total: 0 },
      });
      const draft = candidateState({
        schema,
        data,
      });

      const result = await operation.recompute({ head, draft });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [
          {
            code: 'INVALID_FORMULA_SCHEMA',
            role: 'draft',
            tableCreatedId: 'products-created',
          },
        ],
      });
    },
  );

  it('reports simple formula syntax errors at schema coordinates', async () => {
    const validHead = candidateState({
      schema: candidateSchema({ value: { type: 'number', default: 0 } }),
      data: { value: 0 },
    });
    const invalidDraft = candidateState({
      schema: candidateSchema({
        total: formulaField('number', 'missing * * 2', 0),
      }),
      data: { total: 0 },
    });

    const result = await operation.recompute({
      head: validHead,
      draft: invalidDraft,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'INVALID_FORMULA_SCHEMA',
          role: 'draft',
          tableCreatedId: 'products-created',
          path: '/properties/total',
        }),
      ],
    });
  });

  it('reports a nested array formula error at its schema pointer', async () => {
    const schema = candidateSchema({
      items: {
        type: 'array',
        items: candidateSchema({
          price: { type: 'number', default: 0 },
          total: formulaField('number', 'price * * 2', 0),
        }),
      },
    });
    const validHead = candidateState({
      schema: candidateSchema({ value: { type: 'number', default: 0 } }),
      data: { value: 0 },
    });
    const invalidDraft = candidateState({
      schema,
      data: { items: [{ price: 3, total: 0 }] },
    });

    const result = await operation.recompute({
      head: validHead,
      draft: invalidDraft,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'INVALID_FORMULA_SCHEMA',
          role: 'draft',
          tableCreatedId: 'products-created',
          path: '/properties/items/items/properties/total',
        }),
      ],
    });
  });

  it.each(['missing-schema-reference', '', 'quoted"reference', 'line\nbreak'])(
    'returns a typed blocker for an unknown schema reference without rows',
    async (reference) => {
      const validHead = candidateState({
        schema: candidateSchema({ value: { type: 'number', default: 0 } }),
        data: { value: 0 },
      });
      const invalidDraft = candidateState({
        schema: candidateSchema({
          value: { $ref: reference },
        }),
        data: {},
        withoutDataRow: true,
      });
      const originalHead = structuredClone(validHead);
      const originalDraft = structuredClone(invalidDraft);

      const result = await operation.recompute({
        head: validHead,
        draft: invalidDraft,
      });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [
          expect.objectContaining({
            code: 'INVALID_FORMULA_SCHEMA',
            role: 'draft',
            tableCreatedId: 'products-created',
          }),
        ],
      });
      expect(validHead).toEqual(originalHead);
      expect(invalidDraft).toEqual(originalDraft);
    },
  );

  it('returns the shared missing-reference blocker during Stage5 validation', async () => {
    const head = candidateState({
      schema: candidateSchema({ value: { type: 'number', default: 0 } }),
      data: { value: 0 },
    });
    const draft = candidateState({
      schema: candidateSchema({ value: { $ref: 'missing-stage5-reference' } }),
      data: {},
      withoutDataRow: true,
    });

    const blockers = await operation.validateCandidates(head, draft);

    expect(blockers).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FORMULA_SCHEMA',
        role: 'draft',
        tableCreatedId: 'products-created',
        path: '',
      }),
    );
  });

  it.each(['constructor', '__proto__'])(
    'blocks an inherited schema reference during Stage7 and Stage5: %s',
    async (reference) => {
      const head = candidateState({
        schema: candidateSchema({ value: { type: 'number', default: 0 } }),
        data: { value: 0 },
      });
      const draft = candidateState({
        schema: candidateSchema({ value: { $ref: reference } }),
        data: {},
        withoutDataRow: true,
      });
      expect(
        operation.validateMetaSchema(
          candidateSchema({ value: { $ref: reference } }),
        ),
      ).toBe(true);

      const stage7 = await operation.recompute({ head, draft });
      const stage5 = await operation.validateCandidates(head, draft);

      expect(stage7).toMatchObject({
        status: 'blocked',
        blockers: [
          expect.objectContaining({
            code: 'INVALID_FORMULA_SCHEMA',
            role: 'draft',
            tableCreatedId: 'products-created',
          }),
        ],
      });
      expect(stage5).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_FORMULA_SCHEMA',
          role: 'draft',
          tableCreatedId: 'products-created',
        }),
      );
    },
  );

  it('blocks a required field without a property during Stage7 and Stage5', async () => {
    const invalidSchema = {
      type: 'object',
      properties: {},
      required: ['missing'],
      additionalProperties: false,
    } as JsonSchema;
    const head = candidateState({
      schema: candidateSchema({ value: { type: 'number', default: 0 } }),
      data: { value: 0 },
    });
    const draft = candidateState({
      schema: invalidSchema,
      data: {},
      withoutDataRow: true,
    });
    expect(operation.validateMetaSchema(invalidSchema)).toBe(true);

    const stage7 = await operation.recompute({ head, draft });
    const stage5 = await operation.validateCandidates(head, draft);

    expect(stage7).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'INVALID_FORMULA_SCHEMA',
          role: 'draft',
          tableCreatedId: 'products-created',
        }),
      ],
    });
    expect(stage5).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_FORMULA_SCHEMA',
        role: 'draft',
        tableCreatedId: 'products-created',
      }),
    );
  });

  it('blocks a non-finite formula output only for the affected role', async () => {
    const schema = candidateSchema({
      price: { type: 'number', default: 0 },
      divisor: { type: 'number', default: 1 },
      total: formulaField('number', 'price / divisor', 0),
    });
    expect(operation.validateMetaSchema(schema)).toBe(true);
    const invalidHead = candidateState({
      schema,
      data: { price: 3, divisor: 0, total: 0 },
    });
    const validDraft = candidateState({
      schema,
      data: { price: 6, divisor: 3, total: 0 },
      rowCreatedId: 'draft-row-created',
    });

    const result = await operation.recompute({
      head: invalidHead,
      draft: validDraft,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'INVALID_RESULT_DATA',
          role: 'head',
          tableCreatedId: 'products-created',
          rowCreatedId: 'product-row-created',
          path: '/total',
        }),
      ],
    });
  });

  it('retains the engine rule that a field cannot combine formula and foreign-key metadata', () => {
    const formula = formulaField('string', 'targetId', '');
    const validFormulaSchema = {
      type: 'object',
      properties: { targetId: { type: 'string', default: '' }, link: formula },
      required: ['targetId', 'link'],
      additionalProperties: false,
    };
    const combinedSchema = {
      ...validFormulaSchema,
      properties: {
        ...validFormulaSchema.properties,
        link: { ...formula, foreignKey: 'products' },
      },
    };

    expect(operation.validateMetaSchema(validFormulaSchema)).toBe(true);
    expect(operation.validateMetaSchema(combinedSchema)).toBe(false);
  });

  it('blocks a detached schema that combines formula and foreign-key metadata', async () => {
    const validHead = candidateState({
      schema: candidateSchema({
        targetId: { type: 'string', default: '' },
        link: formulaField('string', 'targetId', ''),
      }),
      data: { targetId: '', link: '' },
    });
    const invalidDraft = candidateState({
      schema: {
        ...candidateSchema({
          targetId: { type: 'string', default: '' },
          link: {
            ...formulaField('string', 'targetId', ''),
            foreignKey: 'products',
          },
        }),
      } as JsonSchema,
      data: { targetId: '', link: '' },
    });

    const result = await operation.recompute({
      head: validHead,
      draft: invalidDraft,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_FORMULA_SCHEMA',
          role: 'draft',
          path: '/properties/link',
        }),
      ]),
    });
  });
});

function invalidFormulaSchemas(): Array<{
  name: string;
  schema: JsonSchema;
  data: JsonValue;
}> {
  return [
    {
      name: 'syntax-error',
      schema: candidateSchema({
        price: { type: 'number', default: 0 },
        total: formulaField('number', 'price * * 2', 0),
      }),
      data: { price: 3, total: 0 },
    },
    {
      name: 'missing-dependency',
      schema: candidateSchema({
        total: formulaField('number', 'missingPrice * 2', 0),
      }),
      data: { total: 0 },
    },
    {
      name: 'cyclic',
      schema: candidateSchema({
        total: formulaField('number', 'other + 1', 0),
        other: formulaField('number', 'total + 1', 0),
      }),
      data: { total: 0, other: 0 },
    },
  ];
}
