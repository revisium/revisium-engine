import { BadRequestException, Injectable } from '@nestjs/common';
import { validateRowId } from 'src/features/share/utils/validateUrlLikeId/validateRowId';
import { validateTableId } from 'src/features/share/utils/validateUrlLikeId/validateTableId';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

@Injectable()
export class DraftRevisionValidationService {
  ensureDraftRevision(revision: { isDraft: boolean } | null): void {
    if (!revision) {
      throw new BadRequestException('Revision not found');
    }

    if (!revision.isDraft) {
      throw new BadRequestException('The revision is not a draft');
    }
  }

  ensureHasChanges(hasChanges: boolean): void {
    if (!hasChanges) {
      throw new BadRequestException('There are no changes');
    }
  }

  ensureValidTableId(tableId: string): void {
    validateTableId(tableId);
  }

  ensureValidRowId(rowId: string): void {
    validateRowId(rowId);
  }

  ensureIdsDifferent(currentId: string, newId: string): void {
    if (currentId === newId) {
      throw new BadRequestException('New ID must be different from current');
    }
  }

  ensureUniqueCandidateIds(candidate: DraftRevisionState): void {
    const tableIds = new Set<string>();
    const tableCreatedIds = new Set<string>();
    for (const table of candidate.tables) {
      const normalizedId = table.id.toLowerCase();
      if (tableIds.has(normalizedId) || tableCreatedIds.has(table.createdId)) {
        throw new BadRequestException('Candidate table IDs must be unique');
      }
      tableIds.add(normalizedId);
      tableCreatedIds.add(table.createdId);
      this.ensureUniqueRows(table.rows);
    }
  }

  private ensureUniqueRows(
    rows: DraftRevisionState['tables'][number]['rows'],
  ): void {
    const rowIds = new Set<string>();
    const rowCreatedIds = new Set<string>();
    for (const row of rows) {
      if (rowIds.has(row.id) || rowCreatedIds.has(row.createdId)) {
        throw new BadRequestException(
          'Candidate row IDs must be unique within each table',
        );
      }
      rowIds.add(row.id);
      rowCreatedIds.add(row.createdId);
    }
  }
}
