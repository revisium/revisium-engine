import { Injectable } from '@nestjs/common';
import type {
  AssembledTarget,
  AssemblySource,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { AppliedUnits } from 'src/features/partial-changes/plan/change-operation';
import {
  distinctBlockers,
  type PlanBlocker,
  unrecordedStructureChangeOf,
} from 'src/features/partial-changes/plan/plan-blocker';
import type { ChangesSnapshot } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { InvalidRows } from 'src/features/partial-changes/validation/invalid-rows';
import { LedgerConsistency } from 'src/features/partial-changes/validation/ledger-consistency';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import {
  hasIntactPublishedPrefix,
  storesMigrationsUnderTheirIds,
} from 'src/features/share/ledger/migration-ledger';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';

export interface AppliedTarget {
  readonly choice: AppliedUnits;
  readonly assembled: AssembledTarget;
}

const PUBLISHED_MIGRATION_ALTERED: PlanBlocker = {
  code: 'ledgerInconsistent',
  message: 'A published migration is missing or changed in the Draft ledger',
};

const MIGRATION_MISFILED: PlanBlocker = {
  code: 'ledgerInconsistent',
  message: 'A migration row is not stored under its own, distinct migration id',
};

@Injectable()
export class TargetValidator {
  private readonly ledgerConsistency: LedgerConsistency;

  constructor(
    private readonly dataValidator: JsonSchemaValidatorService,
    replayer: LedgerReplayer,
  ) {
    this.ledgerConsistency = new LedgerConsistency(replayer);
  }

  // §6.9 step 5, uniqueness over whole target tables, is added here once
  // unique constraints (ADR-0029) exist in the engine.
  public async validate(
    source: AssemblySource,
    { choice, assembled }: AppliedTarget,
  ): Promise<PlanBlocker[]> {
    const unrecorded = unrecordedStructureChangesOf(source, choice);
    const ledger = this.ledgerConsistency.blockersOf(
      source,
      choice,
      assembled.ledger,
    );
    const invalidRows = await new InvalidRows(
      this.dataValidator,
      source,
      choice,
    ).of(assembled);

    return distinctBlockers([
      ...unrecorded,
      ...misfiledMigrationsOf(source.snapshot),
      ...alteredPublishedMigrationsOf(source.snapshot),
      ...unexplainedBy(unrecorded, ledger),
      ...invalidRows,
    ]);
  }
}

function unrecordedStructureChangesOf(
  { snapshot, tables, catalogue }: AssemblySource,
  { operation, applied }: AppliedUnits,
): PlanBlocker[] {
  if (operation !== 'commit') {
    return [];
  }

  const unrecorded = new Set(
    tables
      .filter(({ structure }) => !structure.recorded)
      .map(({ identity }) => identity),
  );

  return snapshot.tables
    .filter((pair) => unrecorded.has(pair.identity))
    .filter((pair) =>
      isApplied(applied, catalogue.lookup.tableUnitOf('structure', pair)),
    )
    .map(unrecordedStructureChangeOf);
}

function isApplied(
  applied: ReadonlySet<string>,
  unit: CatalogueUnit | undefined,
): boolean {
  return unit !== undefined && applied.has(unit.key);
}

function misfiledMigrationsOf({ systemRows }: ChangesSnapshot): PlanBlocker[] {
  const { head, draft } = systemRows.migrations;

  if (
    storesMigrationsUnderTheirIds(head) &&
    storesMigrationsUnderTheirIds(draft)
  ) {
    return [];
  }

  return [MIGRATION_MISFILED];
}

function alteredPublishedMigrationsOf({
  systemRows,
}: ChangesSnapshot): PlanBlocker[] {
  const { head, draft } = systemRows.migrations;

  if (hasIntactPublishedPrefix(head, draft)) {
    return [];
  }

  return [PUBLISHED_MIGRATION_ALTERED];
}

function unexplainedBy(
  unrecorded: readonly PlanBlocker[],
  ledger: readonly PlanBlocker[],
): PlanBlocker[] {
  const tableIds = new Set(unrecorded.map(({ tableId }) => tableId));

  return ledger.filter(({ tableId }) => !tableIds.has(tableId));
}
