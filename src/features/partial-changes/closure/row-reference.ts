import type { CheckContext } from 'src/features/partial-changes/closure/check-context';
import {
  blocking,
  danglingInSource,
  type Finding,
  refusedBy,
  requiring,
} from 'src/features/partial-changes/closure/findings';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import {
  type CatalogueCause,
  type CatalogueReason,
  causedBy,
  type RequiredReasonCode,
} from 'src/features/partial-changes/plan/reason';
import { publicTableIdOf } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

// Public ids of the referring row; `path` is the referring field, the array's
// pointer for a reference inside an array.
export interface ReferringSite {
  readonly tableId: string;
  readonly rowId: string;
  readonly path: string;
}

export interface RowReference {
  readonly site: ReferringSite;
  readonly referenced: TargetTable;
  readonly referencedId: string;
}

export function referringSiteOf(
  referrer: TargetTable,
  rowId: string,
  field: JsonPointer,
): ReferringSite {
  return {
    tableId: publicTableIdOf(referrer.pair),
    rowId,
    path: field.toString(),
  };
}

export function referenceReason(
  { site, referenced, referencedId }: RowReference,
  code: RequiredReasonCode,
  which: string,
  cause?: CatalogueCause,
): CatalogueReason {
  const { tableId, rowId, path } = site;
  const referencedTableId = publicTableIdOf(referenced.pair);

  return causedBy(
    {
      code,
      because: `${tableId}/${rowId}${path} references ${referencedTableId}/${referencedId}, ${which}`,
      site: { kind: 'row', tableId, rowId, path },
      references: {
        kind: 'row',
        tableId: referencedTableId,
        rowId: referencedId,
      },
    },
    cause,
  );
}

export function referencedRowFinding(
  reference: RowReference,
  context: CheckContext,
  culprit: CatalogueCause | undefined,
): Finding {
  const { names } = context;
  const { referenced, referencedId } = reference;
  const provider = referenced.providerOf(referencedId);

  if (provider !== undefined) {
    return requiring(
      provider,
      referenceReason(
        reference,
        'referencedRowMissing',
        `which exists only in ${names.other}`,
        context.appliedCause(culprit),
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

  return blocking(danglingInSource(because, reference.site, culprit?.unitKey));
}
