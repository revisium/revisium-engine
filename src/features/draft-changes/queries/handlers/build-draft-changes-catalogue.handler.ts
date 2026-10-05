import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { RevisionChangesApiService } from 'src/features/revision-changes/revision-changes-api.service';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { projectSchemaViewBaselines } from 'src/features/draft-changes/schema/schema-view-baselines';
import {
  pairSnapshotRows,
  pairSnapshotTables,
} from 'src/features/draft-changes/catalogue/snapshot-pairs';
import { buildRowEntries } from 'src/features/draft-changes/catalogue/row-changes';
import { buildSchemaEffectEntries } from 'src/features/draft-changes/catalogue/schema-effects';
import { buildTableEntries } from 'src/features/draft-changes/catalogue/table-changes';
import { collectFieldBoundaries } from 'src/features/draft-changes/catalogue/field-boundaries';
import { buildProjectedRowFieldEntries } from 'src/features/draft-changes/catalogue/row-fields';
import { validateSchemaProjections } from 'src/features/draft-changes/catalogue/schema-projections';
import { buildViewChangeEntries } from 'src/features/draft-changes/catalogue/view-changes';
import {
  blockedCatalogueResult,
  buildCatalogueResult,
  type TableCatalogueParts,
} from 'src/features/draft-changes/catalogue/catalogue-result';
import type {
  BuildDraftChangesCatalogueResult,
  DraftChangesCatalogueEntry,
} from '../impl/build-draft-changes-catalogue.query';
import { BuildDraftChangesCatalogueQuery } from '../impl/build-draft-changes-catalogue.query';
import type { TablePair } from 'src/features/draft-changes/catalogue/snapshot-pairs';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { ProjectDraftChangesSchemaResult } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { StoredViewsSource } from 'src/features/draft-changes/schema/schema-view-baselines';
import {
  readValidatedViewsSource,
  viewSourceCatalogueBlocker,
} from 'src/features/draft-changes/views/view-source';
import { ViewValidationService } from 'src/features/views/services/view-validation.service';

interface TableViewsSources {
  head: StoredViewsSource;
  draft: StoredViewsSource;
}

@QueryHandler(BuildDraftChangesCatalogueQuery)
export class BuildDraftChangesCatalogueHandler implements IQueryHandler<BuildDraftChangesCatalogueQuery> {
  constructor(
    private readonly revisionChangesApi: RevisionChangesApiService,
    private readonly viewsMigrationService: ViewsMigrationService,
    private readonly viewValidation: ViewValidationService,
  ) {}

  async execute(
    query: BuildDraftChangesCatalogueQuery,
  ): Promise<BuildDraftChangesCatalogueResult> {
    return this.buildCatalogue(query.data);
  }

  private async buildCatalogue(
    data: BuildDraftChangesCatalogueQuery['data'],
  ): Promise<BuildDraftChangesCatalogueResult> {
    const { snapshot, schemaProjections } = data;
    const paired = pairSnapshotTables(snapshot);
    if ('blocker' in paired) {
      return blockedCatalogueResult('AMBIGUOUS_IDENTITY', paired.blocker);
    }
    const viewSources = await this.readTableViewsSources(
      snapshot,
      paired.pairs,
    );
    if ('blocker' in viewSources) {
      return viewSources.blocker;
    }
    const projections = validateSchemaProjections(
      snapshot.fingerprint,
      paired.pairs,
      schemaProjections,
    );
    if ('blocker' in projections) {
      return projections.blocker;
    }

    const tableParts: TableCatalogueParts[] = [];
    for (const pair of paired.pairs) {
      const result = await this.buildTableCatalogue(
        snapshot,
        pair,
        projections.get(pair.createdId),
        viewSources.sources.get(pair.createdId),
      );
      if ('blocker' in result) {
        return result.blocker;
      }
      tableParts.push(result);
    }
    return buildCatalogueResult(snapshot, paired.identityBindings, tableParts);
  }

  private async buildTableCatalogue(
    snapshot: DraftChangesSnapshot,
    pair: TablePair,
    projection:
      | Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
      | undefined,
    viewSources: TableViewsSources | undefined,
  ): Promise<
    TableCatalogueParts | { blocker: BuildDraftChangesCatalogueResult }
  > {
    const rowPairs = pairSnapshotRows(
      pair.createdId,
      pair.head?.rows ?? [],
      pair.draft?.rows ?? [],
    );
    if ('blocker' in rowPairs) {
      return {
        blocker: blockedCatalogueResult(
          'AMBIGUOUS_IDENTITY',
          rowPairs.blocker,
          pair.createdId,
        ),
      };
    }
    const entries: DraftChangesCatalogueEntry[] = [
      ...buildTableEntries(pair),
      ...buildRowEntries(
        pair.createdId,
        pair.head?.id,
        pair.draft?.id,
        rowPairs.pairs,
      ),
    ];
    const identityBindings = rowPairs.bindings;
    const fieldBoundaries = [] as ReturnType<typeof collectFieldBoundaries>;
    if (!pair.head || !pair.draft) {
      entries.push(
        ...buildViewChangeEntries(
          pair,
          viewSources?.head ?? { present: false },
          viewSources?.draft ?? { present: false },
        ),
      );
      return { entries, identityBindings, fieldBoundaries };
    }
    if (!projection) {
      return {
        blocker: blockedCatalogueResult(
          'SCHEMA_PROJECTION_MISMATCH',
          `Missing full projection for shared table '${pair.createdId}'.`,
          pair.createdId,
        ),
      };
    }

    const views = await this.projectViewEntries(
      snapshot,
      pair,
      viewSources ?? { head: { present: false }, draft: { present: false } },
    );
    if ('blocker' in views) {
      return { blocker: views.blocker };
    }
    entries.push(...views.entries);

    entries.push(
      ...buildSchemaEffectEntries(snapshot, pair.createdId, pair.draft.id),
    );
    fieldBoundaries.push(
      ...collectFieldBoundaries(pair.createdId, projection.migratedHead.schema),
    );
    const rowFields = await buildProjectedRowFieldEntries({
      tableCreatedId: pair.createdId,
      tableId: pair.draft.id,
      pairs: rowPairs.pairs,
      projection,
      boundaries: fieldBoundaries,
      compare: (pairs) =>
        this.revisionChangesApi.compareSuppliedRows({ pairs }),
    });
    if ('projectionMismatch' in rowFields) {
      return {
        blocker: blockedCatalogueResult(
          'SCHEMA_PROJECTION_MISMATCH',
          `Full projection is missing a unique migrated Head row for table '${pair.createdId}'.`,
          pair.createdId,
        ),
      };
    }
    if ('ambiguousPath' in rowFields) {
      return {
        blocker: blockedCatalogueResult(
          'AMBIGUOUS_PATH',
          `Supplied row data gives an ambiguous dotted diff path '${rowFields.ambiguousPath}'.`,
          pair.createdId,
        ),
      };
    }
    entries.push(...rowFields);
    return { entries, identityBindings, fieldBoundaries };
  }

  private async projectViewEntries(
    snapshot: DraftChangesSnapshot,
    pair: TablePair,
    sources: TableViewsSources,
  ): Promise<
    | { entries: DraftChangesCatalogueEntry[] }
    | { blocker: BuildDraftChangesCatalogueResult }
  > {
    const viewBaselines = projectSchemaViewBaselines(
      this.viewsMigrationService,
      {
        snapshot,
        tableCreatedId: pair.createdId,
        operation: 'commit',
        headViews: sources.head,
      },
    );
    if (viewBaselines.status === 'blocked') {
      return {
        blocker: blockedCatalogueResult(
          'SCHEMA_PROJECTION_BLOCKED',
          viewBaselines.blocker.message,
          pair.createdId,
        ),
      };
    }
    return {
      entries: buildViewChangeEntries(
        pair,
        sources.head,
        sources.draft,
        viewBaselines.baselines.migratedHead,
      ),
    };
  }

  private async readTableViewsSources(
    snapshot: DraftChangesSnapshot,
    pairs: TablePair[],
  ): Promise<
    | { sources: Map<string, TableViewsSources> }
    | { blocker: BuildDraftChangesCatalogueResult }
  > {
    const sources = new Map<string, TableViewsSources>();
    for (const pair of pairs) {
      const head = pair.head
        ? await readValidatedViewsSource(
            snapshot.head,
            pair.createdId,
            pair.head.id,
            this.viewValidation,
          )
        : { status: 'loaded' as const, source: { present: false } as const };
      if (head.status === 'blocked') {
        const failure = viewSourceCatalogueBlocker(head, pair.createdId);
        return {
          blocker: { status: 'blocked', blockers: [failure] },
        };
      }
      const draft = pair.draft
        ? await readValidatedViewsSource(
            snapshot.draft,
            pair.createdId,
            pair.draft.id,
            this.viewValidation,
          )
        : { status: 'loaded' as const, source: { present: false } as const };
      if (draft.status === 'blocked') {
        const failure = viewSourceCatalogueBlocker(draft, pair.createdId);
        return {
          blocker: { status: 'blocked', blockers: [failure] },
        };
      }
      sources.set(pair.createdId, {
        head: head.source,
        draft: draft.source,
      });
    }
    return { sources };
  }
}
