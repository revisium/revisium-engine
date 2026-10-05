import type { DraftChangesCatalogue } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type {
  DraftChangesSelection,
  ResolveDraftChangesSelectionResult,
} from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type { CandidateSchemaProjectionBinding } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { CalculateDataCandidatesResult } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { RequiredCandidateEffect } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  ResolveCandidateViewsQueryData,
  ResolveCandidateViewsResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import type { CandidateViewCatalogue } from './candidate-view-catalogue';

type SelectedCandidateViewInput = Extract<
  ResolveCandidateViewsQueryData,
  { mode: 'selected' }
>;

type RawCandidateViewPreparation =
  | { status: 'prepared'; input: PreparedCandidateViewInput }
  | {
      status: 'selectionBlocked';
      result: Extract<
        ResolveDraftChangesSelectionResult,
        { status: 'blocked' }
      >;
    }
  | {
      status: 'candidateNeedsEffects';
      result: Extract<
        CalculateDataCandidatesResult,
        { status: 'needsEffects' }
      >;
    }
  | {
      status: 'candidateBlocked';
      result: Extract<CalculateDataCandidatesResult, { status: 'blocked' }>;
    }
  | {
      status: 'dependenciesBlocked';
      result: Extract<
        ResolveCandidateDependenciesResult,
        { status: 'blocked' }
      >;
    };

type CandidateViewPreparationBlocker = Exclude<
  RawCandidateViewPreparation,
  { status: 'prepared' }
>['result'];

export interface PreparedCandidateViewInput {
  query: SelectedCandidateViewInput;
  required: RequiredCandidateEffect[];
  initialSchemaProjectionBindings: CandidateSchemaProjectionBinding[];
}

export interface CandidateViewPipeline {
  resolveViewChange(
    operation: 'commit' | 'discard',
    viewId: string,
    component: string,
  ): Promise<ResolveCandidateViewsResult | { status: 'viewEntryMissing' }>;
  resolveViewConfigurationChange(
    operation: 'commit' | 'discard',
    component: string,
  ): Promise<ResolveCandidateViewsResult | { status: 'viewEntryMissing' }>;
  resolveSchemaField(
    operation: 'commit' | 'discard',
    path: string,
  ): Promise<ResolveCandidateViewsResult | { status: 'schemaEntryMissing' }>;
  resolveSelection(
    operation: 'commit' | 'discard',
    selection: DraftChangesSelection,
  ): Promise<ResolveCandidateViewsResult>;
  resolveSelectionWithBlockers(
    operation: 'commit' | 'discard',
    selection: DraftChangesSelection,
  ): Promise<ResolveCandidateViewsResult | CandidateViewPreparationBlocker>;
  prepareSelectedInput(
    operation: 'commit' | 'discard',
    selection: DraftChangesSelection,
  ): Promise<PreparedCandidateViewInput>;
  resolveSuppliedInput(
    input: SelectedCandidateViewInput,
  ): Promise<ResolveCandidateViewsResult>;
  resolveNoOp(): Promise<ResolveCandidateViewsResult>;
  restoreHead(): Promise<ResolveCandidateViewsResult>;
  restoreHeadFromSnapshot(
    snapshot: DraftChangesSnapshot,
  ): Promise<ResolveCandidateViewsResult>;
}

export function createCandidateViewPipeline({
  changes,
  readSnapshot,
  catalogue,
}: {
  changes: DraftChangesApiService;
  readSnapshot: () => Promise<DraftChangesSnapshot>;
  catalogue: CandidateViewCatalogue;
}): CandidateViewPipeline {
  async function resolveViewChange(
    operation: 'commit' | 'discard',
    viewId: string,
    component: string,
  ): Promise<ResolveCandidateViewsResult | { status: 'viewEntryMissing' }> {
    const snapshot = await readSnapshot();
    const currentCatalogue = await catalogue.catalogue();
    const entry = catalogue.findViewEntry(currentCatalogue, viewId, component);
    if (!entry) {
      return { status: 'viewEntryMissing' };
    }
    return resolveSelectionAt(
      operation,
      { include: [{ kind: 'change', ref: entry.ref }] },
      snapshot,
      currentCatalogue,
    );
  }

  async function resolveViewConfigurationChange(
    operation: 'commit' | 'discard',
    component: string,
  ): Promise<ResolveCandidateViewsResult | { status: 'viewEntryMissing' }> {
    const snapshot = await readSnapshot();
    const currentCatalogue = await catalogue.catalogue();
    const entry = catalogue.findViewConfigurationEntry(
      currentCatalogue,
      component,
    );
    if (!entry) {
      return { status: 'viewEntryMissing' };
    }
    return resolveSelectionAt(
      operation,
      { include: [{ kind: 'change', ref: entry.ref }] },
      snapshot,
      currentCatalogue,
    );
  }

  async function resolveSchemaField(
    operation: 'commit' | 'discard',
    path: string,
  ): Promise<ResolveCandidateViewsResult | { status: 'schemaEntryMissing' }> {
    const snapshot = await readSnapshot();
    const currentCatalogue = await catalogue.catalogue();
    const entry = catalogue.findSchemaEntry(currentCatalogue, path);
    if (!entry) {
      return { status: 'schemaEntryMissing' };
    }
    return resolveSelectionAt(
      operation,
      { include: [{ kind: 'change', ref: entry.ref }] },
      snapshot,
      currentCatalogue,
    );
  }

  async function resolveSelection(
    operation: 'commit' | 'discard',
    selection: DraftChangesSelection,
  ): Promise<ResolveCandidateViewsResult> {
    const snapshot = await readSnapshot();
    const currentCatalogue = await catalogue.catalogue();
    return resolveSelectionAt(operation, selection, snapshot, currentCatalogue);
  }

  async function resolveSelectionWithBlockers(
    operation: 'commit' | 'discard',
    selection: DraftChangesSelection,
  ): Promise<ResolveCandidateViewsResult | CandidateViewPreparationBlocker> {
    const snapshot = await readSnapshot();
    const currentCatalogue = await catalogue.catalogue();
    const preparation = await prepareSelectedInputRawAt(
      operation,
      selection,
      snapshot,
      currentCatalogue,
    );
    if (preparation.status !== 'prepared') {
      return preparation.result;
    }
    return resolveSuppliedInput(preparation.input.query);
  }

  async function resolveSelectionAt(
    operation: 'commit' | 'discard',
    selectionInput: DraftChangesSelection,
    snapshot: DraftChangesSnapshot,
    currentCatalogue: DraftChangesCatalogue,
  ): Promise<ResolveCandidateViewsResult> {
    const preparation = await prepareSelectedInputRawAt(
      operation,
      selectionInput,
      snapshot,
      currentCatalogue,
    );
    return resolveSuppliedInput(requirePreparedInput(preparation).query);
  }

  async function prepareSelectedInput(
    operation: 'commit' | 'discard',
    selection: DraftChangesSelection,
  ): Promise<PreparedCandidateViewInput> {
    const snapshot = await readSnapshot();
    const preparation = await prepareSelectedInputRawAt(
      operation,
      selection,
      snapshot,
      await catalogue.catalogue(),
    );
    return requirePreparedInput(preparation);
  }

  async function prepareSelectedInputRawAt(
    operation: 'commit' | 'discard',
    selectionInput: DraftChangesSelection,
    snapshot: DraftChangesSnapshot,
    currentCatalogue: DraftChangesCatalogue,
  ): Promise<RawCandidateViewPreparation> {
    const selection = await changes.resolveSelection({
      catalogue: currentCatalogue,
      selection: selectionInput,
    });
    if (selection.status !== 'resolved') {
      return { status: 'selectionBlocked', result: selection };
    }
    const candidates = await changes.calculateDataCandidates({
      snapshot,
      operation,
      mode: 'selected',
      catalogue: currentCatalogue,
      selection,
    });
    if (candidates.status === 'needsEffects') {
      return { status: 'candidateNeedsEffects', result: candidates };
    }
    if (candidates.status === 'blocked') {
      return { status: 'candidateBlocked', result: candidates };
    }
    const dependencies = await changes.resolveCandidateDependencies({
      snapshot,
      operation,
      mode: 'selected',
      catalogue: currentCatalogue,
      selection,
    });
    if (dependencies.status !== 'resolved') {
      return { status: 'dependenciesBlocked', result: dependencies };
    }
    return {
      status: 'prepared',
      input: {
        query: {
          mode: 'selected',
          snapshot,
          operation,
          catalogue: currentCatalogue,
          selection,
          effectiveRefs: dependencies.effectiveRefs ?? [],
          schemaProjectionBindings: dependencies.schemaProjectionBindings ?? [],
          head: dependencies.head,
          draft: dependencies.draft,
        },
        required: dependencies.required,
        initialSchemaProjectionBindings:
          candidates.schemaProjectionBindings ?? [],
      },
    };
  }

  function requirePreparedInput(
    preparation: RawCandidateViewPreparation,
  ): PreparedCandidateViewInput {
    if (preparation.status === 'prepared') {
      return preparation.input;
    }
    let message: string;
    if (preparation.status === 'selectionBlocked') {
      message = 'Expected resolved selection';
    } else if (
      preparation.status === 'candidateNeedsEffects' ||
      preparation.status === 'candidateBlocked'
    ) {
      message = 'Expected candidate states';
    } else {
      message = 'Expected dependency resolution';
    }
    throw new Error(`${message}: ${JSON.stringify(preparation.result)}`);
  }

  async function resolveSuppliedInput(
    input: SelectedCandidateViewInput,
  ): Promise<ResolveCandidateViewsResult> {
    return changes.resolveCandidateViews(input);
  }

  async function resolveNoOp(): Promise<ResolveCandidateViewsResult> {
    return resolveSelection('commit', { include: [] });
  }

  async function restoreHead(): Promise<ResolveCandidateViewsResult> {
    return restoreHeadFromSnapshot(await readSnapshot());
  }

  async function restoreHeadFromSnapshot(
    snapshot: DraftChangesSnapshot,
  ): Promise<ResolveCandidateViewsResult> {
    const candidates = await changes.calculateDataCandidates({
      snapshot,
      operation: 'discard',
      mode: 'restoreHead',
    });
    if (candidates.status !== 'calculated') {
      throw new Error(
        `Expected Head restoration candidates: ${JSON.stringify(candidates)}`,
      );
    }
    return changes.resolveCandidateViews({
      mode: 'restoreHead',
      snapshot,
      head: candidates.head,
      draft: candidates.draft,
    });
  }

  return {
    resolveViewChange,
    resolveViewConfigurationChange,
    resolveSchemaField,
    resolveSelection,
    resolveSelectionWithBlockers,
    prepareSelectedInput,
    resolveSuppliedInput,
    resolveNoOp,
    restoreHead,
    restoreHeadFromSnapshot,
  };
}
