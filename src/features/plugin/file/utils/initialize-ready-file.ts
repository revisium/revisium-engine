import { nanoid } from 'nanoid';
import { FileStatus, ID_LENGTH } from 'src/features/plugin/file/consts';
import { FileValueStore } from 'src/features/plugin/file/file-value.store';

export function initializeReadyFile(
  store: FileValueStore,
  fileId = nanoid(ID_LENGTH),
) {
  store.status = FileStatus.ready;
  store.fileId = fileId;
}
