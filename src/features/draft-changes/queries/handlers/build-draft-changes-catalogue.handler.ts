import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { RevisionChangesApiService } from 'src/features/revision-changes/revision-changes-api.service';
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

@QueryHandler(BuildDraftChangesCatalogueQuery)
export class BuildDraftChangesCatalogueHandler implements IQueryHandler<BuildDraftChangesCatalogueQuery> {
  constructor(private readonly revisionChangesApi: RevisionChangesApiService) {}

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
}
