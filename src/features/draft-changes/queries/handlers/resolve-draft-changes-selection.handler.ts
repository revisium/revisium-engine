import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  ResolveDraftChangesSelectionQuery,
  type ResolveDraftChangesSelectionResult,
} from '../impl/resolve-draft-changes-selection.query';
import {
  finalizeSelection,
  resolveChoices,
} from 'src/features/draft-changes/selection/selection-set';

@QueryHandler(ResolveDraftChangesSelectionQuery)
export class ResolveDraftChangesSelectionHandler implements IQueryHandler<ResolveDraftChangesSelectionQuery> {
  async execute(
    query: ResolveDraftChangesSelectionQuery,
  ): Promise<ResolveDraftChangesSelectionResult> {
    return this.resolveSelection(query.data);
  }

  private resolveSelection(
    data: ResolveDraftChangesSelectionQuery['data'],
  ): ResolveDraftChangesSelectionResult {
    const includes = resolveChoices(
      data.catalogue,
      data.selection.include,
      'include',
    );
    if ('blocked' in includes) {
      return includes.blocked;
    }

    const excludes = resolveChoices(
      data.catalogue,
      data.selection.exclude ?? [],
      'exclude',
    );
    if ('blocked' in excludes) {
      return excludes.blocked;
    }

    return finalizeSelection(
      data.catalogue,
      includes.entries,
      excludes.entries,
      excludes.deniedTargets,
    );
  }
}
