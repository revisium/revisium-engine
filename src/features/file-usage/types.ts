export interface FileReference {
  fileId: string;
  hash: string;
  size: bigint;
}

export interface ValidateProjectFileBytesResult {
  projectId: string;
  currentFileBytes: bigint;
  expectedFileBytes: bigint;
  drift: bigint;
  fileBlobCount: number;
  referenceCount: number;
}

export interface RestoreProjectFileBytesResult {
  projectId: string;
  previousFileBytes: bigint;
  nextFileBytes: bigint;
  drift: bigint;
}

export interface BackfillProjectFileBlobsResult {
  projectId: string;
  scannedRowVersions: number;
  blobsCreated: number;
  referencesCreated: number;
  fileBytesAfter: bigint;
  dryRun: boolean;
}

export interface CleanupOrphanedFileBlobsResult {
  blobsTombstoned: number;
  bytesFreed: bigint;
  orphanHashes: string[];
}

export interface CleanupProjectFileUsageResult {
  projectId: string;
  blobsTombstoned: number;
  bytesFreed: bigint;
  orphanHashes: string[];
}

export interface PendingStorageDeletion {
  hash: string;
  size: bigint;
}

export interface ConfirmStorageDeletedResult {
  hashesConfirmed: number;
  blobsDeleted: number;
}
