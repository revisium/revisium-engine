import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  getArraySchema,
  getObjectSchema,
  getRefSchema,
} from '@revisium/schema-toolkit/mocks';
import { FileStatus } from 'src/features/plugin/file/consts';
import { FileReferenceExtractorService } from 'src/features/file-usage/services/file-reference-extractor.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';

describe('FileReferenceExtractorService', () => {
  const jsonSchemaStore = new JsonSchemaStoreService();
  const extractor = new FileReferenceExtractorService();

  const singleFileSchema = getObjectSchema({
    avatar: getRefSchema(SystemSchemaIds.File),
  });

  const multipleFilesSchema = getObjectSchema({
    primary: getRefSchema(SystemSchemaIds.File),
    gallery: getArraySchema(getRefSchema(SystemSchemaIds.File)),
  });

  const nonFileSchema = getObjectSchema({
    name: { type: 'string', default: '' },
    age: { type: 'number', default: 0 },
  });

  function uploadedFile(hash: string, size: number) {
    return {
      status: FileStatus.uploaded,
      fileId: `file-${hash}`,
      url: '',
      fileName: `file-${hash}.bin`,
      hash,
      extension: 'bin',
      mimeType: 'application/octet-stream',
      size,
      width: 0,
      height: 0,
    };
  }

  function readyFile(fileId: string) {
    return {
      status: FileStatus.ready,
      fileId,
      url: '',
      fileName: '',
      hash: '',
      extension: '',
      mimeType: '',
      size: 0,
      width: 0,
      height: 0,
    };
  }

  describe('uploaded file extraction', () => {
    it('extracts a single uploaded file reference', () => {
      const schemaStore = jsonSchemaStore.create(singleFileSchema);

      const references = extractor.extract({
        data: { avatar: uploadedFile('hash-a', 1024) },
        schemaStore,
        rowId: 'row-1',
      });

      expect(references).toEqual([
        { fileId: 'file-hash-a', hash: 'hash-a', size: 1024n },
      ]);
    });

    it('extracts each unique hash from arrays', () => {
      const schemaStore = jsonSchemaStore.create(multipleFilesSchema);

      const references = extractor.extract({
        data: {
          primary: uploadedFile('hash-primary', 2048),
          gallery: [
            uploadedFile('hash-a', 512),
            uploadedFile('hash-b', 256),
            uploadedFile('hash-c', 128),
          ],
        },
        schemaStore,
        rowId: 'row-2',
      });

      const hashes = references
        .map((ref) => ref.hash)
        .sort((a, b) => a.localeCompare(b));
      expect(hashes).toEqual(['hash-a', 'hash-b', 'hash-c', 'hash-primary']);
    });

    it('deduplicates repeated hashes within the same row', () => {
      const schemaStore = jsonSchemaStore.create(multipleFilesSchema);

      const references = extractor.extract({
        data: {
          primary: uploadedFile('hash-same', 1024),
          gallery: [
            uploadedFile('hash-same', 1024),
            uploadedFile('hash-same', 1024),
          ],
        },
        schemaStore,
        rowId: 'row-3',
      });

      expect(references).toHaveLength(1);
      expect(references[0]?.hash).toBe('hash-same');
    });
  });

  describe('exclusion rules', () => {
    it('ignores files with status ready', () => {
      const schemaStore = jsonSchemaStore.create(singleFileSchema);

      const references = extractor.extract({
        data: { avatar: readyFile('ready-id') },
        schemaStore,
        rowId: 'row-4',
      });

      expect(references).toEqual([]);
    });

    it('ignores uploaded files without a hash', () => {
      const schemaStore = jsonSchemaStore.create(singleFileSchema);

      const malformed = { ...uploadedFile('', 1024), hash: '' };

      const references = extractor.extract({
        data: { avatar: malformed },
        schemaStore,
        rowId: 'row-5',
      });

      expect(references).toEqual([]);
    });

    it('returns empty references when the row has no file fields', () => {
      const schemaStore = jsonSchemaStore.create(nonFileSchema);

      const references = extractor.extract({
        data: { name: 'anton', age: 42 },
        schemaStore,
        rowId: 'row-6',
      });

      expect(references).toEqual([]);
    });
  });

  describe('type conversion', () => {
    it('converts size to bigint', () => {
      const schemaStore = jsonSchemaStore.create(singleFileSchema);

      const references = extractor.extract({
        data: { avatar: uploadedFile('hash-bigsize', 123456789) },
        schemaStore,
        rowId: 'row-7',
      });

      expect(references[0]?.size).toBe(123456789n);
      expect(typeof references[0]?.size).toBe('bigint');
    });
  });
});
