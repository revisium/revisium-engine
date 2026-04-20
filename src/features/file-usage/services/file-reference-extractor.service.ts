import { Injectable } from '@nestjs/common';
import { createJsonValueStore } from '@revisium/schema-toolkit/lib';
import { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import { JsonValue } from '@revisium/schema-toolkit/types';
import { FileStatus } from 'src/features/plugin/file/consts';
import { forEachFile } from 'src/features/plugin/file/utils/fore-each-file';
import { FileReference } from 'src/features/file-usage/types';

@Injectable()
export class FileReferenceExtractorService {
  public extract(args: {
    data: JsonValue;
    schemaStore: JsonSchemaStore;
    rowId: string;
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

    return references;
  }
}
