import { Module } from '@nestjs/common';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { ShareModule } from 'src/features/share/share.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';

@Module({
  imports: [DatabaseModule, ShareModule],
  providers: [ChangesSnapshotReader],
})
export class PartialChangesModule {}
