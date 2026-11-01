import { DanglingRowReferences } from 'src/features/partial-changes/closure/dangling-row-references';
import { LedgerDependencyChecks } from 'src/features/partial-changes/closure/ledger-dependency-checks';
import { RowIdCollisions } from 'src/features/partial-changes/closure/row-id-collisions';
import { TableIdCollisions } from 'src/features/partial-changes/closure/table-id-collisions';
import { TableReferences } from 'src/features/partial-changes/closure/table-references';
import { UnchangedReferrersOfLostIds } from 'src/features/partial-changes/closure/unchanged-referrers-of-lost-ids';
import { ViewsAgainstStructure } from 'src/features/partial-changes/closure/views-against-structure';
import { WholesaleRowReferences } from 'src/features/partial-changes/closure/wholesale-row-references';

export const TARGET_CHECKS = Symbol('TARGET_CHECKS');

export const TARGET_CHECKS_IN_SPEC_ORDER = [
  TableIdCollisions,
  TableReferences,
  ViewsAgainstStructure,
  WholesaleRowReferences,
  LedgerDependencyChecks,
  RowIdCollisions,
  DanglingRowReferences,
  UnchangedReferrersOfLostIds,
];
