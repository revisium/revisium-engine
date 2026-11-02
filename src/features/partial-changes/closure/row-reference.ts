import {
  blocking,
  danglingInSource,
  type Finding,
  refusedBy,
  requiring,
} from 'src/features/partial-changes/closure/findings';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import type { SideNames } from 'src/features/partial-changes/plan/change-operation';
import type {
  Reason,
  RequiredReasonCode,
} from 'src/features/partial-changes/plan/reason';

export interface ReferringSite {
  readonly tableId: string;
  readonly rowId: string;
  readonly path?: string;
}

export interface RowReference {
  readonly site: ReferringSite;
  readonly referenced: TargetTable;
  readonly referencedId: string;
}

export function referenceReason(
  { site, referenced, referencedId }: RowReference,
  code: RequiredReasonCode,
  which: string,
): Reason {
  const { tableId, rowId, path = '' } = site;

  return {
    code,
    ...site,
    because: `${tableId}/${rowId}${path} references ${referenced.tableId}/${referencedId}, ${which}`,
  };
}

export function referencedRowFinding(
  reference: RowReference,
  names: SideNames,
  culprit: string | undefined,
): Finding {
  const { referenced, referencedId } = reference;
  const provider = referenced.providerOf(referencedId);

  if (provider !== undefined) {
    return requiring(
      provider,
      referenceReason(
        reference,
        'referencedRowMissing',
        `which exists only in ${names.other}`,
      ),
    );
  }

  if (referenced.refusal) {
    return refusedBy(referenced.refusal);
  }

  const { because } = referenceReason(
    reference,
    'referencedRowMissing',
    `which the ${names.target} does not contain`,
  );

  return blocking(danglingInSource(because, reference.site, culprit));
}
