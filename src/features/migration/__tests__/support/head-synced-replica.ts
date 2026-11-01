import type { Migration } from '@revisium/schema-toolkit/types';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  prepareBranch,
  type BranchGraph,
} from 'src/__tests__/utils/prepareProject';
import { commitDraft, findRevisionId } from './migration-scenario';
import { readLedger, readRows, readSchema } from './revision-records';

export interface HeadSyncedReplica {
  syncWith(sourceHeadRevisionId: string): Promise<void>;
  syncRowsWith(sourceHeadRevisionId: string, tableId: string): Promise<void>;
  readHeadSchema(tableId: string): Promise<unknown>;
  readHeadLedger(): Promise<Migration[]>;
}

export async function givenHeadSyncedReplica(
  kit: MigrationTestKit,
  sourceHeadRevisionId: string,
): Promise<HeadSyncedReplica> {
  const replica = headSyncedReplica(kit, await prepareBranch(kit.prisma));
  await replica.syncWith(sourceHeadRevisionId);

  return replica;
}

function headSyncedReplica(
  kit: MigrationTestKit,
  branch: BranchGraph,
): HeadSyncedReplica {
  const headRevisionId = () => findRevisionId(kit, branch.branchId, 'isHead');

  return {
    async syncWith(sourceHeadRevisionId) {
      const imported = await readLedger(kit, await headRevisionId());
      const importedIds = new Set(imported.map(({ id }) => id));
      const migrations = (await readLedger(kit, sourceHeadRevisionId)).filter(
        ({ id }) => !importedIds.has(id),
      );

      if (migrations.length === 0) {
        return;
      }

      await expect(
        kit.draftApi.applyMigrations({
          revisionId: await findRevisionId(kit, branch.branchId, 'isDraft'),
          migrations,
        }),
      ).resolves.toEqual(
        migrations.map(({ id }) => ({ id, status: 'applied' })),
      );
      await commitDraft(kit, branch);
    },

    async syncRowsWith(sourceHeadRevisionId, tableId) {
      const rows = await readRows(kit, {
        revisionId: sourceHeadRevisionId,
        tableId,
      });

      await kit.draftApi.apiCreateRows({
        revisionId: await findRevisionId(kit, branch.branchId, 'isDraft'),
        tableId,
        rows: rows.map(({ id, data }) => ({
          rowId: id,
          data: data as InputJsonValue,
        })),
        isRestore: true,
      });
      await commitDraft(kit, branch);
    },

    async readHeadSchema(tableId) {
      return readSchema(kit, { revisionId: await headRevisionId(), tableId });
    },

    async readHeadLedger() {
      return readLedger(kit, await headRevisionId());
    },
  };
}
