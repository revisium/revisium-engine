import { Injectable } from '@nestjs/common';
import type { AppliedUnits } from 'src/features/partial-changes/assembly/outcome-rules';
import {
  type AssembledTarget,
  type AssemblySource,
  unrecordedStructureChangeOf,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { LedgerReplayRules } from 'src/features/partial-changes/head-schema/head-schema-check';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';
import { distinctBlockers } from 'src/features/partial-changes/selection/selection-resolver';
import type { ChangesSnapshot } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { InvalidRows } from 'src/features/partial-changes/validation/invalid-rows';
import { LedgerConsistency } from 'src/features/partial-changes/validation/ledger-consistency';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import {
  hasIntactPublishedPrefix,
  storesMigrationsUnderTheirIds,
} from 'src/features/share/ledger/migration-ledger';

export interface ValidatedTarget {
  readonly choice: AppliedUnits;
  readonly target: AssembledTarget;
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
    schemaStore: JsonSchemaStoreService,
  ) {
    const replayRules: LedgerReplayRules = {
      refs: schemaStore.refs,
      validator: dataValidator,
    };

    this.ledgerConsistency = new LedgerConsistency(replayRules);
  }

  // §6.9 step 5, uniqueness over whole target tables, is added here once
  // unique constraints (ADR-0029) exist in the engine.
  public async validate(
    source: AssemblySource,
    { choice, target }: ValidatedTarget,
  ): Promise<PlanBlocker[]> {
    const unrecorded = unrecordedStructureChangesOf(source, choice);
    const ledger = this.ledgerConsistency.blockersOf(source, choice);
    const invalidRows = await new InvalidRows(
      this.dataValidator,
      source,
      choice,
    ).of(target);

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

  const lookup = new CatalogueLookup(catalogue);
  const unrecorded = new Set(
    tables
      .filter(({ structure }) => !structure.recorded)
      .map(({ identity }) => identity),
  );

  return snapshot.tables
    .filter((pair) => unrecorded.has(pair.identity))
    .filter((pair) => isApplied(applied, lookup.tableUnitOf('structure', pair)))
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
