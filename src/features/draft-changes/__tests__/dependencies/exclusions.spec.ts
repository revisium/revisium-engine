import {
  givenLinkedTargetCandidate,
  givenSelfRowRenameWithForeignKey,
  givenSelfTableRenameWithForeignKey,
  resolveDependencies,
} from './support/dependency-scenario';
import { givenSelfRowRenameWithDeniedArrayReference } from './support/dependency-array-scenario';

describe('draft changes candidate dependency exclusions', () => {
  it('blocks an exact denied row prerequisite for a required FK target', async () => {
    const scenario = await givenLinkedTargetCandidate({
      targetRows: [{ createdId: 'required-target', data: { code: 'Target' } }],
      excludeRequiredTarget: true,
    });

    const result = await resolveDependencies(scenario.data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'EXCLUDED_PREREQUISITE',
          role: 'head',
          tableCreatedId: 'stable-secondary-products',
          rowCreatedId: 'required-target',
        }),
      ],
    });
  });

  it('blocks a generated schema rewrite at an explicitly denied FK path', async () => {
    const scenario = await givenSelfTableRenameWithForeignKey({
      deniedSchemaPath: '/properties/link',
    });

    const result = await resolveDependencies(scenario.data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'EXCLUDED_REFERENCE_REWRITE',
          role: 'head',
          tableCreatedId: 'stable-products',
          path: '/properties/link',
        }),
      ],
    });
  });

  it('blocks a generated row rewrite at an unchanged explicitly denied FK field', async () => {
    const scenario = await givenSelfRowRenameWithForeignKey('commit', true);

    const result = await resolveDependencies(scenario.data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'EXCLUDED_REFERENCE_REWRITE',
          role: 'head',
          tableCreatedId: 'stable-products',
          rowCreatedId: 'product',
          path: '/link',
        }),
      ],
    });
  });

  it('blocks an array rewrite when its atomic parent is explicitly denied', async () => {
    const scenario = await givenSelfRowRenameWithDeniedArrayReference();

    const result = await resolveDependencies(scenario.data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'EXCLUDED_REFERENCE_REWRITE',
          role: 'head',
          tableCreatedId: 'stable-products',
          rowCreatedId: 'product',
          path: '/links',
        }),
      ],
    });
  });
});
