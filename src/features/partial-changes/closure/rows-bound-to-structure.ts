import { Injectable } from '@nestjs/common';
import type { StructureBoundRow } from 'src/features/partial-changes/assembly/target-assembler';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  type Finding,
  requiring,
} from 'src/features/partial-changes/closure/findings';
import type { CatalogueReason } from 'src/features/partial-changes/plan/reason';

// A created or replaced row that a commit would move into the Head structure with a default in place of its Draft
// value at a changed field needs the structure that owns that value (SPEC §6.6).
@Injectable()
export class RowsBoundToStructure implements TargetCheck, TargetChecking {
  public checkingOf(): TargetChecking {
    return this;
  }

  public findingsOf(context: CheckContext): Promise<Finding[]> {
    return Promise.resolve(
      context.target.structureBoundRows.map((row) =>
        requiring(row.structureKey, this.reasonOf(row)),
      ),
    );
  }

  private reasonOf({
    unitKey,
    tableId,
    rowId,
    path,
  }: StructureBoundRow): CatalogueReason {
    return {
      code: 'structureBoundData',
      because: `${tableId}/${rowId}${path} holds a value of a changed field, which the Head structure would replace by a default; the value follows the structure of ${tableId}`,
      site: { kind: 'row', tableId, rowId, path },
      cause: { unitKey, role: 'referrer' },
    };
  }
}
