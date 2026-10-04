import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { givenDraftProjectWithSchema } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { DraftChangesModule } from 'src/features/draft-changes/draft-changes.module';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  DiscardedDataField,
  ProjectDraftChangesSchemaResult,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';

const headSchema = getObjectSchema({
  price: getNumberSchema(),
  title: getStringSchema(),
});

type SchemaOperation = 'commit' | 'discard';

export async function createPersistedSchemaTestKit() {
  const kit = await createDraftTestKit({
    imports: [DraftChangesModule],
    migrationOptions: { workerMode: 'disabled' },
  });
  const changes = kit.module.get(DraftChangesApiService);

  return {
    close: () => kit.close(),
    givenEditedRename: () => givenEditedRename(kit, changes),
    givenEditedSiblingAdds: () => givenEditedSiblingAdds(kit, changes),
    givenRenameWithUnorderedRequired: () =>
      givenEditedRename(kit, changes, {
        ...headSchema,
        required: ['title', 'price'],
      }),
  };
}

async function givenEditedRename(
  kit: Awaited<ReturnType<typeof createDraftTestKit>>,
  changes: DraftChangesApiService,
  schema: JsonSchema = headSchema,
) {
  const fixture = await givenDraftProjectWithSchema({
    prismaService: kit.prismaService,
    schema,
    row: { data: { price: 10, title: 'Head' } },
  });
  await kit.draftApiService.apiUpdateTable({
    revisionId: fixture.draftRevisionId,
    tableId: fixture.tableId,
    patches: [
      { op: 'move', from: '/properties/price', path: '/properties/cost' },
    ],
  });
  await kit.draftApiService.apiUpdateRow({
    revisionId: fixture.draftRevisionId,
    tableId: fixture.tableId,
    rowId: fixture.rowId,
    data: { cost: 15, title: 'Draft' },
  });

  const readSnapshot = () =>
    changes.readSnapshot({
      projectId: fixture.projectId,
      branchName: fixture.branchName,
    });

  const discardRecordedRenameAndReplacement = async (
    discardedDataFields: DiscardedDataField[] = [],
  ) => {
    const snapshot = await readSnapshot();
    return changes.projectSchema({
      snapshot,
      tableCreatedId: findTableCreatedId(snapshot, fixture.tableId),
      operation: 'discard',
      effects: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 0 },
      ],
      discardedDataFields,
    });
  };

  return {
    readSnapshot,
    replaceRenamedPriceWithString: async () => {
      await kit.draftApiService.apiUpdateTable({
        revisionId: fixture.draftRevisionId,
        tableId: fixture.tableId,
        patches: [
          { op: 'replace', path: '/properties/cost', value: getStringSchema() },
        ],
      });
      await kit.draftApiService.apiUpdateRow({
        revisionId: fixture.draftRevisionId,
        tableId: fixture.tableId,
        rowId: fixture.rowId,
        data: { cost: 'custom', title: 'Draft' },
      });
    },
    discardRecordedRenameAndReplacement,
    discardRequiredDataFields: async (
      blocked: ProjectDraftChangesSchemaResult,
    ) =>
      requireProjection(
        await discardRecordedRenameAndReplacement(
          requireDiscardedFields(blocked),
        ),
      ),
    renameTable: (nextTableId: string) =>
      kit.draftApiService.apiRenameTable({
        revisionId: fixture.draftRevisionId,
        tableId: fixture.tableId,
        nextTableId,
      }),
    project: async (operation: SchemaOperation) => {
      const snapshot = await readSnapshot();
      const tableCreatedId = findTableCreatedId(snapshot, fixture.tableId);
      const result = await changes.projectSchema({
        snapshot,
        tableCreatedId,
        operation,
        effects: [{ historyIndex: 1, patchIndex: 0 }],
      });
      return requireProjection(result);
    },
  };
}

function findTableCreatedId(
  snapshot: Awaited<ReturnType<DraftChangesApiService['readSnapshot']>>,
  tableId: string,
): string {
  const table = snapshot.head.tables.find(({ id }) => id === tableId);
  if (!table) {
    throw new Error(`Expected Head table '${tableId}'.`);
  }
  return table.createdId;
}

function requireProjection(
  result: ProjectDraftChangesSchemaResult,
): Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }> {
  if (result.status !== 'projected') {
    throw new Error(
      `Expected schema projection: ${JSON.stringify(result.blockers)}`,
    );
  }
  return result;
}

function requireDiscardedFields(
  result: ProjectDraftChangesSchemaResult,
): DiscardedDataField[] {
  if (result.status !== 'blocked') {
    throw new Error('Expected a blocked schema projection.');
  }
  const fields = result.blockers.flatMap(
    ({ requiredDataFields }) => requiredDataFields ?? [],
  );
  if (fields.length === 0) {
    throw new Error('Expected actionable data fields in projection blockers.');
  }
  return fields;
}

async function givenEditedSiblingAdds(
  kit: Awaited<ReturnType<typeof createDraftTestKit>>,
  changes: DraftChangesApiService,
) {
  const fixture = await givenDraftProjectWithSchema({
    prismaService: kit.prismaService,
    schema: getObjectSchema({ title: getStringSchema() }),
    row: { data: { title: 'Head' } },
  });
  for (const name of ['x', 'y']) {
    await kit.draftApiService.apiUpdateTable({
      revisionId: fixture.draftRevisionId,
      tableId: fixture.tableId,
      patches: [
        { op: 'add', path: `/properties/${name}`, value: getNumberSchema() },
      ],
    });
  }
  await kit.draftApiService.apiUpdateRow({
    revisionId: fixture.draftRevisionId,
    tableId: fixture.tableId,
    rowId: fixture.rowId,
    data: { title: 'Head', x: 41, y: 0 },
  });
  const projectRecordedEffect = async (
    operation: SchemaOperation,
    historyIndex: number,
  ) => {
    const snapshot = await changes.readSnapshot({
      projectId: fixture.projectId,
      branchName: fixture.branchName,
    });
    return changes.projectSchema({
      snapshot,
      tableCreatedId: findTableCreatedId(snapshot, fixture.tableId),
      operation,
      effects: [{ historyIndex, patchIndex: 0 }],
    });
  };
  const secondAddedFieldHistoryIndex = 2;

  return {
    discardFirstAddedField: () => projectRecordedEffect('discard', 1),
    commitSecondAddedField: async () =>
      requireProjection(
        await projectRecordedEffect('commit', secondAddedFieldHistoryIndex),
      ),
  };
}
