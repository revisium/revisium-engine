import { findStateRow } from 'src/features/draft-changes/__tests__/candidates-postgres/support/candidate-results';
import {
  createPersistedFormulaScenario,
  candidateCalculationSummary,
  formulaSchema,
  requireCandidateResult,
} from './support/persisted-formula-scenario';
import { requireRecomputed } from '../formulas/support/formula-candidate';
import { requireResolvedDependencies } from './support/persisted-formula-scenario';

describe('Draft Changes candidate formulas: persisted pipeline', () => {
  let kit: Awaited<ReturnType<typeof createPersistedFormulaScenario>>;

  beforeAll(async () => {
    kit = await createPersistedFormulaScenario();
  });

  afterAll(async () => kit?.close());

  it('recomputes Head and Draft independently without writing source snapshots', async () => {
    const scenario = await kit.givenProduct(
      formulaSchema(),
      { price: 5, quantity: 3, title: 'Head', total: 0 },
      { price: 5, quantity: 4, title: 'Draft', total: 0 },
    );
    await scenario.tamperFormulaValue('head', {
      price: 5,
      quantity: 3,
      title: 'Head',
      total: 0,
    });
    await scenario.tamperFormulaValue('draft', {
      price: 5,
      quantity: 4,
      title: 'Draft',
      total: 0,
    });
    const before = await scenario.readSnapshot();

    const result = requireRecomputed(await scenario.recalculate());

    expect(findStateRow(result.head, 'products', 'product').data).toEqual({
      price: 5,
      quantity: 3,
      title: 'Head',
      total: 15,
    });
    expect(findStateRow(result.draft, 'products', 'product').data).toEqual({
      price: 5,
      quantity: 4,
      title: 'Draft',
      total: 20,
    });
    expect(await scenario.readSnapshot()).toEqual(before);
  });

  it('validates a recalculated candidate while retaining stale source values for later stages', async () => {
    const scenario = await kit.givenProduct(
      formulaSchema(),
      { price: 5, quantity: 3, title: 'Head', total: 15 },
      { price: 5, quantity: 4, title: 'Draft', total: 20 },
    );
    await scenario.tamperFormulaValue('draft', {
      price: 5,
      quantity: 4,
      title: 'Draft',
      total: 'stale',
    });
    const selection = {
      include: [
        {
          kind: 'rowFields' as const,
          tableId: 'products',
          rowId: 'product',
          paths: ['/title'],
        },
      ],
    };

    const candidateResult = await scenario.calculate('commit', selection);
    expect(candidateResult).toMatchObject({ status: 'calculated' });
    const candidates = requireCandidateResult(candidateResult);
    const resolved = requireResolvedDependencies(
      await scenario.resolveDependencies('commit', selection),
    );
    const formulas = requireRecomputed(
      await scenario.recompute(resolved.head, resolved.draft),
    );

    expect(
      findStateRow(candidates.draft, 'products', 'product').data,
    ).toMatchObject({
      total: 'stale',
    });
    expect(
      findStateRow(candidates.head, 'products', 'product').data,
    ).toMatchObject({
      title: 'Draft',
    });
    expect(
      findStateRow(formulas.head, 'products', 'product').data,
    ).toMatchObject({
      total: 15,
    });
    expect(
      findStateRow(formulas.draft, 'products', 'product').data,
    ).toMatchObject({
      total: 20,
    });
  });

  it('keeps an invalid editable input blocked after formula evaluation', async () => {
    const scenario = await kit.givenProduct(
      formulaSchema(),
      { price: 5, quantity: 3, title: 'Head', total: 15 },
      { price: 5, quantity: 4, title: 'Draft', total: 20 },
    );
    await scenario.tamperFormulaValue('draft', {
      price: 'invalid',
      quantity: 4,
      title: 'Draft',
      total: 20,
    });

    const result = await scenario.recalculate();

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

  it('discards a selected multiplier while recalculating both resulting roles', async () => {
    const scenario = await kit.givenProduct(
      formulaSchema(),
      { price: 5, quantity: 3, title: 'Head', total: 15 },
      { price: 5, quantity: 4, title: 'Draft', total: 20 },
    );
    const selection = {
      include: [
        {
          kind: 'rowFields' as const,
          tableId: 'products',
          rowId: 'product',
          paths: ['/quantity'],
        },
      ],
    };

    const resolved = requireResolvedDependencies(
      await scenario.resolveDependencies('discard', selection),
    );
    const formulas = requireRecomputed(
      await scenario.recompute(resolved.head, resolved.draft),
    );

    expect(
      findStateRow(formulas.head, 'products', 'product').data,
    ).toMatchObject({
      quantity: 3,
      total: 15,
    });
    expect(
      findStateRow(formulas.draft, 'products', 'product').data,
    ).toMatchObject({
      quantity: 3,
      total: 15,
    });
  });

  it('restores Head when the original Draft contains invalid editable data', async () => {
    const scenario = await kit.givenProduct(
      formulaSchema(),
      { price: 5, quantity: 3, title: 'Head', total: 15 },
      { price: 5, quantity: 4, title: 'Draft', total: 20 },
    );
    await scenario.tamperFormulaValue('draft', {
      price: 'invalid',
      quantity: 4,
      title: 'Draft',
      total: 'stale',
    });
    const before = await scenario.readSnapshot();
    const { candidates: candidateResult, dependencies } =
      await scenario.restoreHead();
    expect(candidateCalculationSummary(candidateResult)).toMatchObject({
      status: 'calculated',
    });
    requireCandidateResult(candidateResult);
    const resolved = requireResolvedDependencies(dependencies);
    const formulas = requireRecomputed(
      await scenario.recompute(resolved.head, resolved.draft),
    );

    expect(findStateRow(formulas.head, 'products', 'product').data).toEqual({
      price: 5,
      quantity: 3,
      title: 'Head',
      total: 15,
    });
    expect(findStateRow(formulas.draft, 'products', 'product').data).toEqual({
      price: 5,
      quantity: 3,
      title: 'Head',
      total: 15,
    });
    expect(await scenario.readSnapshot()).toEqual(before);
  });

  it('recalculates formulas while restoring a renamed editable field', async () => {
    const scenario = await kit.givenProduct(
      formulaSchema(),
      { price: 5, quantity: 3, title: 'Head', total: 15 },
      { price: 5, quantity: 4, title: 'Draft', total: 20 },
    );
    await scenario.renameTitleToLabel();
    await scenario.tamperFormulaOutput('draft', 'stale');
    const before = await scenario.readSnapshot();
    const selection = {
      include: [
        {
          kind: 'schemaFields' as const,
          tableId: 'products',
          paths: ['/properties/label'],
        },
      ],
    };

    const candidates = await scenario.calculate('discard', selection);
    expect(candidateCalculationSummary(candidates)).toEqual({
      status: 'calculated',
    });
    const candidateResult = requireCandidateResult(candidates);
    const dependencies = requireResolvedDependencies(
      await scenario.resolveDependencies('discard', selection),
    );
    const formulas = requireRecomputed(
      await scenario.recompute(dependencies.head, dependencies.draft),
    );

    expect(
      findStateRow(candidateResult.draft, 'products', 'product').data,
    ).toMatchObject({ total: 'stale' });
    expect(
      findStateRow(formulas.head, 'products', 'product').data,
    ).toMatchObject({ total: 15 });
    expect(
      findStateRow(formulas.draft, 'products', 'product').data,
    ).toMatchObject({ total: 20 });
    expect(await scenario.readSnapshot()).toEqual(before);
  });
});
