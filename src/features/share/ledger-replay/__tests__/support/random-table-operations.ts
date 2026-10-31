import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { getForeignKeysFromSchema } from '@revisium/schema-toolkit/lib';
import { arr, bool, num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import {
  JsonSchemaTypeName,
  type JsonObjectSchema,
  type JsonPatch,
  type JsonSchema,
  type Migration,
} from '@revisium/schema-toolkit/types';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import { RevisionsApiService } from 'src/features/revision/revisions-api.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import type { SchemaRefs } from 'src/features/share/ledger-replay/ledger-replay';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { seededRandom, type SeededRandom } from './seeded-random';

const MAX_FIELDS_PER_TABLE = 3;
const MAX_PATCHES_PER_UPDATE = 3;

type DraftSchemas = ReadonlyMap<string, JsonObjectSchema>;
type TableOperation = 'create' | 'update' | 'rename' | 'remove';
type PatchKind = 'add' | 'remove' | 'replace' | 'move' | 'addNested';
type PatchableFields = Map<string, JsonSchema>;

export interface NativeDraft {
  refs: SchemaRefs;
  readLedger(): Promise<Migration[]>;
  readSchemas(): Promise<DraftSchemas>;
}

export async function givenDraftAfterRandomTableOperations(
  kit: DraftTestKit,
  { seed, operations }: { seed: number; operations: number },
): Promise<NativeDraft> {
  const { draftRevisionId } = await prepareBranch(kit.prismaService);
  const draft = nativeDraft(kit, draftRevisionId);
  const writer = new RandomTableWriter(
    kit,
    draftRevisionId,
    seededRandom(seed),
  );

  for (let written = 0; written < operations; written += 1) {
    await writer.writeRandomOperation(await draft.readSchemas());
  }

  return draft;
}

function nativeDraft(kit: DraftTestKit, revisionId: string): NativeDraft {
  return {
    refs: kit.module.get(JsonSchemaStoreService).refs,
    readLedger: () =>
      kit.module.get(RevisionsApiService).migrations({ revisionId }),
    readSchemas: () => readDraftSchemas(kit, revisionId),
  };
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

class RandomTableWriter {
  private tableCount = 0;
  private fieldCount = 0;

  constructor(
    private readonly kit: DraftTestKit,
    private readonly revisionId: string,
    private readonly random: SeededRandom,
  ) {}

  public writeRandomOperation(schemas: DraftSchemas): Promise<unknown> {
    switch (this.random.pick(this.applicableOperations(schemas))) {
      case 'create':
        return this.createTable(schemas);
      case 'update':
        return this.updateTable(schemas);
      case 'rename':
        return this.renameTable(schemas);
      case 'remove':
        return this.removeTable(schemas);
    }
  }

  private applicableOperations(schemas: DraftSchemas): TableOperation[] {
    if (schemas.size === 0) {
      return ['create'];
    }

    const operations: TableOperation[] = [
      'create',
      'update',
      'update',
      'rename',
    ];
    if (this.removableTables(schemas).length > 0) {
      operations.push('remove');
    }

    return operations;
  }

  private createTable(schemas: DraftSchemas) {
    const tableId = this.nextTableId();
    const referenceTargets = [...tableIdsOf(schemas), tableId];

    return this.kit.draftApiService.apiCreateTable({
      revisionId: this.revisionId,
      tableId,
      schema: obj(this.randomFields(referenceTargets)),
    });
  }

  private updateTable(schemas: DraftSchemas) {
    const tableId = this.random.pick(tableIdsOf(schemas));
    const fields: PatchableFields = new Map(
      Object.entries(schemaOf(schemas, tableId).properties),
    );

    return this.kit.draftApiService.apiUpdateTable({
      revisionId: this.revisionId,
      tableId,
      patches: this.randomPatches(fields, tableIdsOf(schemas)),
    });
  }

  private renameTable(schemas: DraftSchemas) {
    return this.kit.draftApiService.apiRenameTable({
      revisionId: this.revisionId,
      tableId: this.random.pick(tableIdsOf(schemas)),
      nextTableId: this.nextTableId(),
    });
  }

  private removeTable(schemas: DraftSchemas) {
    return this.kit.draftApiService.apiRemoveTable({
      revisionId: this.revisionId,
      tableId: this.random.pick(this.removableTables(schemas)),
    });
  }

  private removableTables(schemas: DraftSchemas): string[] {
    const referencedByOthers = new Set(
      [...schemas].flatMap(([tableId, schema]) =>
        this.foreignKeysOf(schema).filter((target) => target !== tableId),
      ),
    );

    return tableIdsOf(schemas).filter(
      (tableId) => !referencedByOthers.has(tableId),
    );
  }

  private foreignKeysOf(schema: JsonSchema): string[] {
    return getForeignKeysFromSchema(
      this.kit.module.get(JsonSchemaStoreService).create(schema),
    );
  }

  private randomPatches(fields: PatchableFields, referenceTargets: string[]) {
    const count = this.random.count(1, MAX_PATCHES_PER_UPDATE);

    return Array.from({ length: count }, () =>
      this.randomPatch(fields, referenceTargets),
    );
  }

  private randomPatch(
    fields: PatchableFields,
    referenceTargets: string[],
  ): JsonPatch {
    switch (this.random.pick(applicablePatchKinds(fields))) {
      case 'add':
        return this.addFieldPatch(fields, referenceTargets);
      case 'remove':
        return this.removeFieldPatch(fields);
      case 'replace':
        return this.replaceFieldPatch(fields, referenceTargets);
      case 'move':
        return this.moveFieldPatch(fields);
      case 'addNested':
        return this.addNestedFieldPatch(fields, referenceTargets);
    }
  }

  private addFieldPatch(
    fields: PatchableFields,
    referenceTargets: string[],
  ): JsonPatch {
    const name = this.nextFieldName();
    const value = this.randomField(referenceTargets);
    fields.set(name, value);

    return { op: 'add', path: fieldPath(name), value };
  }

  private removeFieldPatch(fields: PatchableFields): JsonPatch {
    const name = this.random.pick([...fields.keys()]);
    fields.delete(name);

    return { op: 'remove', path: fieldPath(name) };
  }

  private replaceFieldPatch(
    fields: PatchableFields,
    referenceTargets: string[],
  ): JsonPatch {
    const name = this.random.pick([...fields.keys()]);
    const value = this.randomField(referenceTargets);
    fields.set(name, value);

    return { op: 'replace', path: fieldPath(name), value };
  }

  private moveFieldPatch(fields: PatchableFields): JsonPatch {
    const from = this.random.pick([...fields.keys()]);
    // The schema toolkit cannot patch a field moved earlier in the same patch list.
    fields.delete(from);

    return {
      op: 'move',
      from: fieldPath(from),
      path: fieldPath(this.nextFieldName()),
    };
  }

  private addNestedFieldPatch(
    fields: PatchableFields,
    referenceTargets: string[],
  ): JsonPatch {
    const parent = this.random.pick(objectFieldsOf(fields));
    const value = this.randomField(referenceTargets);

    return {
      op: 'add',
      path: `${fieldPath(parent)}${fieldPath(this.nextFieldName())}`,
      value,
    };
  }

  private randomFields(referenceTargets: string[]) {
    const count = this.random.count(1, MAX_FIELDS_PER_TABLE);

    return Object.fromEntries(
      Array.from({ length: count }, () => [
        this.nextFieldName(),
        this.randomField(referenceTargets),
      ]),
    );
  }

  private randomField(referenceTargets: string[]): JsonSchema {
    const reference = () =>
      str({ foreignKey: this.random.pick(referenceTargets) });
    const fieldFactories = [
      () => str(),
      () => num(),
      () => bool(),
      () => ref(SystemSchemaIds.File),
      reference,
      () => arr(reference()),
      () => obj({ [this.nextFieldName()]: reference() }),
    ];

    return this.random.pick(fieldFactories)();
  }

  private nextTableId(): string {
    this.tableCount += 1;
    return `table-${this.tableCount}`;
  }

  private nextFieldName(): string {
    this.fieldCount += 1;
    return `field_${this.fieldCount}`;
  }
}

function applicablePatchKinds(fields: PatchableFields): PatchKind[] {
  const kinds: PatchKind[] = ['add'];
  if (fields.size > 0) {
    kinds.push('replace', 'move');
  }
  if (fields.size > 1) {
    kinds.push('remove');
  }
  if (objectFieldsOf(fields).length > 0) {
    kinds.push('addNested');
  }

  return kinds;
}

function objectFieldsOf(fields: PatchableFields): string[] {
  return [...fields]
    .filter(
      ([, schema]) =>
        'type' in schema && schema.type === JsonSchemaTypeName.Object,
    )
    .map(([name]) => name);
}

function tableIdsOf(schemas: DraftSchemas): string[] {
  return [...schemas.keys()].sort((left, right) => left.localeCompare(right));
}

function schemaOf(schemas: DraftSchemas, tableId: string): JsonObjectSchema {
  const schema = schemas.get(tableId);
  if (!schema) {
    throw new Error(`Draft has no schema for ${tableId}`);
  }

  return schema;
}

function fieldPath(name: string): string {
  return `/properties/${name}`;
}
