import { Injectable } from '@nestjs/common';
import {
  AssemblyInput,
  TargetAssembler,
} from 'src/features/partial-changes-poc/assembly/target-assembler.service';
import { TargetState } from 'src/features/partial-changes-poc/assembly/target.types';
import { StructureConsistencyChecks } from 'src/features/partial-changes-poc/dependencies/structure-consistency-checks.service';
import {
  Finding,
  TargetConsistencyChecks,
} from 'src/features/partial-changes-poc/dependencies/target-consistency-checks.service';
import {
  Blocker,
  RequiredReason,
} from 'src/features/partial-changes-poc/partial-changes.types';
import { requiredExcludedBlocker } from 'src/features/partial-changes-poc/selection/resolve-selection';

export interface ClosureInput extends Omit<AssemblyInput, 'applied'> {
  selected: ReadonlySet<string>;
  required: ReadonlyMap<string, RequiredReason>;
  excluded: ReadonlySet<string>;
}

export interface ClosureResult {
  applied: Set<string>;
  required: Map<string, RequiredReason>;
  blockers: Blocker[];
  target: TargetState;
}

@Injectable()
export class DependencyClosure {
  constructor(
    private readonly assembler: TargetAssembler,
    private readonly rowChecks: TargetConsistencyChecks,
    private readonly structureChecks: StructureConsistencyChecks,
  ) {}

  async close(input: ClosureInput): Promise<ClosureResult> {
    const applied = new Set([...input.selected, ...input.required.keys()]);
    const required = new Map(input.required);

    for (;;) {
      const target = await this.assembler.assemble({ ...input, applied });
      const findings = [
        ...(await this.structureChecks.find({
          snapshot: input.snapshot,
          catalogue: input.catalogue,
          state: target,
          applied,
        })),
        ...(await this.rowChecks.find(target, applied)),
      ];
      const { added, blockers } = this.absorb(
        findings,
        input,
        applied,
        required,
      );

      if (added === 0) {
        return {
          applied,
          required,
          blockers: uniqueBlockers([...target.blockers, ...blockers]),
          target,
        };
      }
    }
  }

  private absorb(
    findings: Finding[],
    input: ClosureInput,
    applied: Set<string>,
    required: Map<string, RequiredReason>,
  ): { added: number; blockers: Blocker[] } {
    const blockers: Blocker[] = [];
    const addedNow = new Set<string>();

    for (const finding of findings) {
      if (finding.type === 'blocker') {
        blockers.push(finding.blocker);
      } else if (addedNow.has(finding.unit)) {
        continue;
      } else if (input.excluded.has(finding.unit)) {
        blockers.push(requiredExcludedBlocker(finding.reason));
      } else if (applied.has(finding.unit)) {
        blockers.push(unresolvedBlocker(finding.reason));
      } else {
        applied.add(finding.unit);
        required.set(finding.unit, finding.reason);
        addedNow.add(finding.unit);
      }
    }

    return { added: addedNow.size, blockers };
  }
}

function unresolvedBlocker(reason: RequiredReason): Blocker {
  return {
    code: 'danglingInSource',
    tableId: reason.tableId,
    rowId: reason.rowId,
    path: reason.path,
    message: `The source state is inconsistent: ${reason.because}`,
  };
}

function uniqueBlockers(blockers: Blocker[]): Blocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = JSON.stringify(blocker);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
