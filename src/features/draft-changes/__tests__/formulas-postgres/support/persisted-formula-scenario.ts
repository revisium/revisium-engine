import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { givenDraftProjectWithSchema } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { DraftChangesModule } from 'src/features/draft-changes/draft-changes.module';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { DraftChangesCatalogue } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSelection } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import { findStateRow } from 'src/features/draft-changes/__tests__/candidates-postgres/support/candidate-results';

export async function createPersistedFormulaScenario() {
  const kit = await createDraftTestKit({
    imports: [DraftChangesModule],
    migrationOptions: { workerMode: 'disabled' },
  });
  const changes = kit.module.get(DraftChangesApiService);

  const givenProduct = async (
    schema: JsonSchema,
    headData: Record<string, unknown>,
    draftData = headData,
  ) => {
    const fixture = await givenDraftProjectWithSchema({
      prismaService: kit.prismaService,
      schema,
      tableId: 'products',
      row: { rowId: 'product', data: headData, draftData },
    });
    const readSnapshot = () =>
      changes.readSnapshot({
        projectId: fixture.projectId,
        branchName: fixture.branchName,
      });
    const recalculate = async () => {
      const snapshot = await readSnapshot();
      return changes.recomputeCandidateFormulas({
        head: snapshot.head,
        draft: snapshot.draft,
      });
    };
    const recompute = (head: DraftRevisionState, draft: DraftRevisionState) =>
      changes.recomputeCandidateFormulas({ head, draft });
    const renameTitleToLabel = async () => {
      const snapshot = await readSnapshot();
      await kit.draftApiService.apiUpdateTable({
        revisionId: snapshot.draft.id,
        tableId: 'products',
        patches: [
          { op: 'move', from: '/properties/title', path: '/properties/label' },
        ],
      });
    };
    const tamperFormulaValue = async (
      role: 'head' | 'draft',
      data: Record<string, unknown>,
    ) => {
      const snapshot = await readSnapshot();
      const currentRow = findStateRow(snapshot[role], 'products', 'product');
      await kit.prismaService.row.update({
        where: { versionId: currentRow.versionId },
        data: { data: data as InputJsonValue },
      });
    };
    const tamperFormulaOutput = async (
      role: 'head' | 'draft',
      value: unknown,
    ) => {
      const snapshot = await readSnapshot();
      const currentRow = findStateRow(snapshot[role], 'products', 'product');
      await kit.prismaService.row.update({
        where: { versionId: currentRow.versionId },
        data: {
          data: {
            ...(currentRow.data as Record<string, unknown>),
            total: value,
          } as InputJsonValue,
        },
      });
    };
    const calculate = async (
      operation: 'commit' | 'discard',
      selection: DraftChangesSelection,
    ) => {
      const snapshot = await readSnapshot();
      const catalogue = await buildCatalogue(changes, snapshot);
      const selected = await changes.resolveSelection({ catalogue, selection });
      if (selected.status !== 'resolved') {
        throw new Error('Expected persisted formula selection to resolve.');
      }
      return changes.calculateDataCandidates({
        snapshot,
        operation,
        mode: 'selected',
        catalogue,
        selection: selected,
      });
    };
    const resolveDependencies = async (
      operation: 'commit' | 'discard',
      selection: DraftChangesSelection,
    ) => {
      const snapshot = await readSnapshot();
      const catalogue = await buildCatalogue(changes, snapshot);
      const selected = await changes.resolveSelection({ catalogue, selection });
      if (selected.status !== 'resolved') {
        throw new Error('Expected persisted formula selection to resolve.');
      }
      return changes.resolveCandidateDependencies({
        snapshot,
        operation,
        mode: 'selected',
        catalogue,
        selection: selected,
      });
    };
    const restoreHead = async () => {
      const snapshot = await readSnapshot();
      const candidates = await changes.calculateDataCandidates({
        snapshot,
        operation: 'discard',
        mode: 'restoreHead',
      });
      const dependencies = await changes.resolveCandidateDependencies({
        snapshot,
        operation: 'discard',
        mode: 'restoreHead',
      });
      return { candidates, dependencies };
    };
    return {
      readSnapshot,
      recalculate,
      recompute,
      calculate,
      resolveDependencies,
      restoreHead,
      renameTitleToLabel,
      tamperFormulaValue,
      tamperFormulaOutput,
    };
  };

  return {
    close: () => kit.close(),
    givenProduct,
  };
}

export function formulaSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      price: { type: 'number', default: 0 },
      quantity: { type: 'number', default: 1 },
      title: { type: 'string', default: '' },
      total: {
        type: 'number',
        default: 0,
        readOnly: true,
        'x-formula': { version: 1, expression: 'price * quantity' },
      },
    },
    required: ['price', 'quantity', 'title', 'total'],
    additionalProperties: false,
  } as JsonSchema;
}

export function requireResolvedDependencies(
  result: ResolveCandidateDependenciesResult,
): Extract<ResolveCandidateDependenciesResult, { status: 'resolved' }> {
  if (result.status !== 'resolved') {
    throw new Error('Expected persisted candidate dependencies to resolve.');
  }
  return result;
}

export function requireCandidateResult(
  result: Awaited<
    ReturnType<DraftChangesApiService['calculateDataCandidates']>
  >,
): Extract<
  Awaited<ReturnType<DraftChangesApiService['calculateDataCandidates']>>,
  { status: 'calculated' }
> {
  if (result.status !== 'calculated') {
    throw new Error('Expected persisted formula candidate calculation.');
  }
  return result;
}

export function candidateCalculationSummary(
  result: Awaited<
    ReturnType<DraftChangesApiService['calculateDataCandidates']>
  >,
) {
  if (result.status === 'calculated') {
    return { status: result.status } as const;
  }
  if (result.status === 'blocked') {
    return { status: result.status, blockers: result.blockers } as const;
  }
  return { status: result.status, requirements: result.requirements } as const;
}

async function buildCatalogue(
  changes: DraftChangesApiService,
  snapshot: DraftChangesSnapshot,
): Promise<DraftChangesCatalogue> {
  const draftTables = new Set(
    snapshot.draft.tables.map(({ createdId }) => createdId),
  );
  const sharedTables = snapshot.head.tables.filter(
    ({ createdId, system }) => !system && draftTables.has(createdId),
  );
  const schemaProjections = await Promise.all(
    sharedTables.map(async (table) => ({
      tableCreatedId: table.createdId,
      projection: await changes.projectSchema({
        snapshot,
        tableCreatedId: table.createdId,
        operation: 'commit',
        effects: [],
      }),
    })),
  );
  const result = await changes.buildCatalogue({ snapshot, schemaProjections });
  if (result.status !== 'catalogued') {
    throw new Error(
      `Expected persisted formula catalogue: ${JSON.stringify({ result, schemaProjections })}`,
    );
  }
  return result.catalogue;
}
