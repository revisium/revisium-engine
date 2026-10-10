import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  DraftChangesCatalogue,
  DraftChangesIdentityBinding,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import {
  resolveRow,
  resolveTable,
} from 'src/features/draft-changes/selection/entity-selectors';

export function requireTableBinding(
  catalogue: DraftChangesCatalogue,
  tableId: string,
): DraftChangesIdentityBinding {
  const resolution = resolveTable(catalogue, tableId);
  if ('blocker' in resolution) {
    throwResolutionError(resolution.blocker, `Table '${tableId}'`);
  }
  return resolution.binding;
}

export function requireRowBinding(
  catalogue: DraftChangesCatalogue,
  tableCreatedId: string,
  rowId: string,
): DraftChangesIdentityBinding {
  const resolution = resolveRow(catalogue, tableCreatedId, rowId);
  if ('blocker' in resolution) {
    throwResolutionError(resolution.blocker, `Row '${rowId}'`);
  }
  return resolution.binding;
}

export function currentPublicId(binding: DraftChangesIdentityBinding): string {
  const id = binding.draftIds[0] ?? binding.headIds[0];
  if (!id) {
    throw new BadRequestException('Catalogue identity has no public ID.');
  }
  return id;
}

export function previousPublicId(
  binding: DraftChangesIdentityBinding,
): string | null {
  const headId = binding.headIds[0];
  const draftId = binding.draftIds[0];
  return headId && draftId && headId !== draftId ? headId : null;
}

function throwResolutionError(
  blocker: 'UNKNOWN_TARGET' | 'AMBIGUOUS_IDENTITY',
  label: string,
): never {
  if (blocker === 'UNKNOWN_TARGET') {
    throw new NotFoundException(`${label} was not found.`);
  }
  throw new BadRequestException(`${label} matches multiple stable identities.`);
}
