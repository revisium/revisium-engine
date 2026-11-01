import { Module } from '@nestjs/common';
import { RowMerger } from 'src/features/partial-changes/assembly/row-merger';
import { SystemTargetAssembler } from 'src/features/partial-changes/assembly/system-target-assembler';
import { TargetAssembler } from 'src/features/partial-changes/assembly/target-assembler';
import { DependencyClosure } from 'src/features/partial-changes/closure/dependency-closure';
import { TARGET_CHECKS } from 'src/features/partial-changes/closure/findings';
import { RowReferenceChecks } from 'src/features/partial-changes/closure/row-reference-checks';
import { StructureChecks } from 'src/features/partial-changes/closure/structure-checks';
import { OperationEstimator } from 'src/features/partial-changes/limits/operation-estimator';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import { PlanFingerprint } from 'src/features/partial-changes/planning/plan-fingerprint';
import { ReadScope } from 'src/features/partial-changes/scope/read-scope';
import { ScopedCatalogueReader } from 'src/features/partial-changes/scope/scoped-catalogue-reader.service';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { TargetValidator } from 'src/features/partial-changes/validation/target-validator';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { ShareModule } from 'src/features/share/share.module';
import { ViewsModule } from 'src/features/views/views.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';

@Module({
  imports: [DatabaseModule, ShareModule, PluginModule, ViewsModule],
  providers: [
    ChangesSnapshotReader,
    {
      provide: NativeSchemaRules,
      useFactory: (
        schemaStore: JsonSchemaStoreService,
        validator: JsonSchemaValidatorService,
      ) => new NativeSchemaRules(schemaStore.refs, validator),
      inject: [JsonSchemaStoreService, JsonSchemaValidatorService],
    },
    ReadScope,
    PartialChangesLimits,
    ScopedCatalogueReader,
    RowMerger,
    SystemTargetAssembler,
    TargetAssembler,
    OperationEstimator,
    StructureChecks,
    RowReferenceChecks,
    {
      provide: TARGET_CHECKS,
      useFactory: (
        structureChecks: StructureChecks,
        rowChecks: RowReferenceChecks,
      ) => [structureChecks, rowChecks],
      inject: [StructureChecks, RowReferenceChecks],
    },
    DependencyClosure,
    TargetValidator,
    PlanFingerprint,
  ],
})
export class PartialChangesModule {}
