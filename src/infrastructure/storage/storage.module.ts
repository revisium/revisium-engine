import { DynamicModule, Global, Module } from '@nestjs/common';
import { NullStorageService } from 'src/infrastructure/storage/null-storage.service';
import {
  IStorageService,
  STORAGE_SERVICE,
} from 'src/infrastructure/storage/storage.interface';

@Global()
@Module({})
export class StorageModule {
  static forRoot(storage?: IStorageService): DynamicModule {
    return {
      module: StorageModule,
      global: true,
      providers: [
        {
          provide: STORAGE_SERVICE,
          useValue: storage ?? new NullStorageService(),
        },
      ],
      exports: [STORAGE_SERVICE],
    };
  }
}
