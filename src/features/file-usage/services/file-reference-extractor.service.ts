import { Injectable, Logger } from '@nestjs/common';
import { createJsonValueStore } from '@revisium/schema-toolkit/lib';
import { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import { JsonValue } from '@revisium/schema-toolkit/types';
import { FileStatus } from 'src/features/plugin/file/consts';
import { forEachFile } from 'src/features/plugin/file/utils/fore-each-file';
import { FileReference } from 'src/features/file-usage/types';

const ZERO_BYTES = 0n;

@Injectable()
export class FileReferenceExtractorService {
  private readonly logger = new Logger(FileReferenceExtractorService.name);

  public extract(args: {
    data: JsonValue;
    schemaStore: JsonSchemaStore;
    rowId: string;
    projectId?: string;
  }): FileReference[] {
    const valueStore = createJsonValueStore(
      args.schemaStore,
      args.rowId,
      args.data,
    );

    const references: FileReference[] = [];
    const seen = new Set<string>();

    forEachFile(valueStore, (item) => {
      if (item.status !== FileStatus.uploaded) {
        return;
      }

      if (!item.hash) {
        return;
      }

      if (seen.has(item.hash)) {
        return;
      }

      seen.add(item.hash);

      references.push({
        fileId: item.fileId,
        hash: item.hash,
        size: BigInt(item.size),
      });
    });

    return this.filterNegativeSizes(references, args);
  }

  private filterNegativeSizes(
    references: readonly FileReference[],
    args: { rowId: string; projectId?: string },
  ): FileReference[] {
    return references.filter((reference) => {
      if (reference.size >= ZERO_BYTES) {
        return true;
      }

      this.logger.warn({
        message: 'Dropped file reference with negative size',
        projectId: args.projectId,
        rowId: args.rowId,
        fileId: reference.fileId,
        hash: reference.hash,
        size: reference.size,
      });

      return false;
    });
  }
}
