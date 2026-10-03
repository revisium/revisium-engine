import hash from 'object-hash';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  DraftRevisionGetOrCreateDraftTableCommand,
  type DraftRevisionGetOrCreateDraftTableCommandReturnType,
} from 'src/features/draft-revision/commands/impl/draft-revision-get-or-create-draft-table.command';
import {
  DraftRevisionGetOrCreateDraftRowCommand,
  type DraftRevisionGetOrCreateDraftRowCommandReturnType,
} from 'src/features/draft-revision/commands/impl/draft-revision-get-or-create-draft-row.command';
import type { RowChangesScenario } from './row-scenario';
import { rowVersion } from './persistence';

export async function tamperSchemaWithoutHistory(
  f: RowChangesScenario,
  data: InputJsonValue,
) {
  const kit = f.kit;
  const row = await kit.transactionService.runSerializable(async () => {
    const table = await kit.commandBus.execute<
      DraftRevisionGetOrCreateDraftTableCommand,
      DraftRevisionGetOrCreateDraftTableCommandReturnType
    >(
      new DraftRevisionGetOrCreateDraftTableCommand({
        revisionId: await f.revisionId('draft'),
        tableId: SystemTables.Schema,
      }),
    );
    return kit.commandBus.execute<
      DraftRevisionGetOrCreateDraftRowCommand,
      DraftRevisionGetOrCreateDraftRowCommandReturnType
    >(
      new DraftRevisionGetOrCreateDraftRowCommand({
        tableVersionId: table.tableVersionId,
        rowId: f.tableId,
      }),
    );
  });
  await kit.prismaService.row.update({
    where: { versionId: row.rowVersionId },
    data: { data, hash: hash(data) },
  });
}

export async function tamperRowHash(f: RowChangesScenario) {
  const row = await rowVersion(f, 'draft');
  await f.kit.prismaService.row.update({
    where: { versionId: row.versionId },
    data: { hash: 'invalid-stored-hash' },
  });
}
