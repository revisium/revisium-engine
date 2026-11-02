import { OutcomeRules } from 'src/features/partial-changes/assembly/outcome-rules';
import type { AssembledTarget } from 'src/features/partial-changes/assembly/target-assembler';
import type {
  CheckSource,
  Finding,
} from 'src/features/partial-changes/closure/findings';
import type { TableSchemas } from 'src/features/partial-changes/closure/table-schemas';
import {
  type TargetTable,
  TargetTables,
} from 'src/features/partial-changes/closure/target-tables';
import {
  type AppliedUnits,
  type SideNames,
  sideNamesOf,
} from 'src/features/partial-changes/plan/change-operation';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

export interface TargetCheck {
  checkingOf(source: CheckSource): TargetChecking;
}

export interface TargetChecking {
  findingsOf(context: CheckContext): Promise<Finding[]>;
}

export class CheckContext {
  public readonly rules: OutcomeRules;
  public readonly tables: TargetTables;
  public readonly names: SideNames;

  constructor(
    public readonly source: CheckSource,
    public readonly schemas: TableSchemas,
    public readonly target: AssembledTarget,
    public readonly choice: AppliedUnits,
  ) {
    this.rules = new OutcomeRules(choice);
    this.tables = new TargetTables(source, target, this.rules);
    this.names = sideNamesOf(choice.operation);
  }

  public structureOf(pair: TablePair): string | undefined {
    return this.source.catalogue.lookup.tableUnitOf('structure', pair)?.key;
  }

  public unappliedStructureHolding(
    referrer: TargetTable,
    pointer: JsonPointer,
  ): string | undefined {
    const structure = this.structureOf(referrer.pair);

    if (
      structure === undefined ||
      this.rules.isApplied(structure) ||
      !referrer.isChangedField(pointer)
    ) {
      return undefined;
    }

    return structure;
  }
}
