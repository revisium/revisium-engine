import {
  type BranchScenarioTestKit,
  type BranchScenarioTestKitOptions,
  createBranchScenarioTestKit,
} from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { TargetAssembler } from 'src/features/partial-changes/assembly/target-assembler';
import { DependencyClosure } from 'src/features/partial-changes/closure/dependency-closure';
import { PartialChangesApiService } from 'src/features/partial-changes/partial-changes-api.service';
import { PartialChangesModule } from 'src/features/partial-changes/partial-changes.module';
import { PlanFingerprint } from 'src/features/partial-changes/planning/plan-fingerprint';
import { ScopedCatalogueReader } from 'src/features/partial-changes/scope/scoped-catalogue-reader.service';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { ComparedSnapshotReader } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import { TargetValidator } from 'src/features/partial-changes/validation/target-validator';

export interface PartialChangesTestKit extends BranchScenarioTestKit {
  partialChangesApi: PartialChangesApiService;
  snapshotReader: ChangesSnapshotReader;
  comparedSnapshotReader: ComparedSnapshotReader;
  scopedCatalogueReader: ScopedCatalogueReader;
  targetAssembler: TargetAssembler;
  dependencyClosure: DependencyClosure;
  targetValidator: TargetValidator;
  planFingerprint: PlanFingerprint;
}

export type PartialChangesTestKitOptions = Omit<
  BranchScenarioTestKitOptions,
  'featureModules'
>;

export async function createPartialChangesTestKit(
  options: PartialChangesTestKitOptions = {},
): Promise<PartialChangesTestKit> {
  const kit = await createBranchScenarioTestKit({
    ...options,
    featureModules: [PartialChangesModule],
  });
  const { module } = kit;

  return {
    ...kit,
    partialChangesApi: module.get(PartialChangesApiService),
    snapshotReader: module.get(ChangesSnapshotReader),
    comparedSnapshotReader: module.get(ComparedSnapshotReader),
    scopedCatalogueReader: module.get(ScopedCatalogueReader),
    targetAssembler: module.get(TargetAssembler),
    dependencyClosure: module.get(DependencyClosure),
    targetValidator: module.get(TargetValidator),
    planFingerprint: module.get(PlanFingerprint),
  };
}
