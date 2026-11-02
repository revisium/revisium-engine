import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import type { Finding } from 'src/features/partial-changes/closure/findings';
import { type AddressedUnit, addressedUnitOf } from './catalogue-reading';
import type { AppliedUnits } from 'src/features/partial-changes/plan/change-operation';
import type { Reason } from 'src/features/partial-changes/plan/reason';

export type CheckScript = (pass: ScriptedPass) => Finding[];

const NO_FINDINGS: CheckScript = () => [];

export class ScriptedCheck implements TargetCheck {
  private script = NO_FINDINGS;

  public follow(script: CheckScript): void {
    this.script = script;
  }

  public forget(): void {
    this.script = NO_FINDINGS;
  }

  public checkingOf(source: AssemblySource): TargetChecking {
    return {
      findingsOf: ({ choice }: CheckContext) =>
        Promise.resolve(
          this.script(new ScriptedPass(source.catalogue, choice)),
        ),
    };
  }
}

export class ScriptedPass {
  constructor(
    private readonly catalogue: ChangeCatalogue,
    private readonly choice: AppliedUnits,
  ) {}

  public applies(unit: AddressedUnit): boolean {
    return this.choice.applied.has(this.keyOf(unit));
  }

  public requires(unit: AddressedUnit, reason: Reason): Finding {
    return { kind: 'requires', unitKey: this.keyOf(unit), reason };
  }

  public requiresUntilApplied(
    unit: AddressedUnit,
    reason: Reason,
    { after }: { readonly after?: AddressedUnit } = {},
  ): Finding[] {
    if (this.applies(unit) || (after && !this.applies(after))) {
      return [];
    }

    return [this.requires(unit, reason)];
  }

  private keyOf(address: AddressedUnit): string {
    const unit = this.catalogue.units.find((candidate) =>
      deepEqual(addressedUnitOf(candidate), address),
    );

    if (!unit) {
      throw new Error(`The catalogue has no unit ${JSON.stringify(address)}`);
    }

    return unit.key;
  }
}
