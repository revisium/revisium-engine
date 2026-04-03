import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { ShareModule } from 'src/features/share/share.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { StorageModule } from 'src/infrastructure/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    StorageModule,
    ShareModule,
    PluginModule,
  ],
})
export class AppModule {}
