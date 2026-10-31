import type {
  JsonObjectSchema,
  Migration,
} from '@revisium/schema-toolkit/types';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import { RevisionsApiService } from 'src/features/revision/revisions-api.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import {
  replayLedger,
  type ReplayedLedger,
} from 'src/features/share/ledger-replay/ledger-replay';
import { SystemTables } from 'src/features/share/system-tables.consts';

export type DraftSchemas = ReadonlyMap<string, JsonObjectSchema>;

export interface NativeDraft {
  write(migration: Migration): Promise<unknown>;
  readLedger(): Promise<Migration[]>;
  readSchemas(): Promise<DraftSchemas>;
}

export async function givenNativeDraft(
  kit: DraftTestKit,
  ...migrations: Migration[]
): Promise<NativeDraft> {
  const { draftRevisionId } = await prepareBranch(kit.prismaService);
  const draft = nativeDraft(kit, draftRevisionId);

  for (const migration of migrations) {
    await draft.write(migration);
  }

  return draft;
}

export function replayWithNativeRules(
  kit: DraftTestKit,
  ledger: Migration[],
): ReplayedLedger {
  return replayLedger({
    ledger,
    refs: kit.module.get(JsonSchemaStoreService).refs,
    validator: kit.module.get(JsonSchemaValidatorService),
  });
}

function nativeDraft(kit: DraftTestKit, revisionId: string): NativeDraft {
  return {
    write: (migration) => writeNatively(kit, revisionId, migration),
    readLedger: () =>
      kit.module.get(RevisionsApiService).migrations({ revisionId }),
    readSchemas: () => readDraftSchemas(kit, revisionId),
  };
}

function writeNatively(
  kit: DraftTestKit,
  revisionId: string,
  migration: Migration,
): Promise<unknown> {
  switch (migration.changeType) {
    case 'init':
      return kit.draftApiService.apiCreateTable({
        revisionId,
        tableId: migration.tableId,
        schema: migration.schema,
      });
    case 'update':
      return kit.draftApiService.apiUpdateTable({
        revisionId,
        tableId: migration.tableId,
        patches: migration.patches,
      });
    case 'rename':
      return kit.draftApiService.apiRenameTable({
        revisionId,
        tableId: migration.tableId,
        nextTableId: migration.nextTableId,
      });
    case 'remove':
      return kit.draftApiService.apiRemoveTable({
        revisionId,
        tableId: migration.tableId,
      });
  }
}

async function readDraftSchemas(
  kit: DraftTestKit,
  revisionId: string,
): Promise<DraftSchemas> {
  const schemaRows = await kit.prismaService.row.findMany({
    where: {
      tables: {
        some: {
          id: SystemTables.Schema,
          revisions: { some: { id: revisionId } },
        },
      },
    },
    select: { id: true, data: true },
  });

  return new Map(
    schemaRows.map(({ id, data }) => [id, data as unknown as JsonObjectSchema]),
  );
}
