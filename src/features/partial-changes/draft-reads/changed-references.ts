import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type { TableSchemas } from 'src/features/partial-changes/closure/table-schemas';
import type { DraftRowEntry } from 'src/features/partial-changes/draft-reads/draft-row';
import { pointerOfNativeFieldPath } from 'src/features/partial-changes/draft-reads/native-field-path';
import {
  type ComparedTable,
  hasDifferentVersions,
  type TablePair,
  type TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  type ForeignKeyReference,
  getForeignKeyReferences,
} from 'src/features/share/foreign-key-references';

// A changed value of a row that references one row of a table under its Head id and another under its Draft id.
export interface ChangedReference {
  readonly site: ReferenceSite;
  readonly referenced: ComparedTable;
  readonly previousRowId: string;
  readonly rowId: string;
}

export interface ReferenceSite {
  readonly tableIdentity: string;
  readonly rowIdentity: string;
  readonly pointer: string;
}

type ReferencesByPointer = ReadonlyMap<string, ForeignKeyReference>;

// The changed references of a page's rows into tables whose rows may be renamed. A refused table has no units, so its
// rows follow no rename and its renames are followed by nothing.
export class ChangedReferences {
  private readonly refused: ReadonlySet<string>;
  private readonly headTables: ReadonlyMap<string, TablePair>;
  private readonly draftTables: ReadonlyMap<string, TablePair>;
  private readonly renamable: ReadonlyMap<string, ComparedTable>;

  constructor(
    { snapshot, tables, headSchema }: ComparedSnapshot,
    private readonly schemas: TableSchemas,
  ) {
    this.refused = new Set(headSchema.refusedTablesByIdentity.keys());
    this.headTables = tablesById(snapshot.tables, ({ head }) => head);
    this.draftTables = tablesById(snapshot.tables, ({ draft }) => draft);
    this.renamable = new Map(
      tables
        .filter(
          (table) =>
            hasDifferentVersions(table) && !this.refused.has(table.identity),
        )
        .map((table) => [table.identity, table]),
    );
  }

  public of(entries: readonly DraftRowEntry[]): ChangedReference[] {
    return entries
      .filter(({ table }) => !this.refused.has(table.identity))
      .flatMap((entry) => this.changedReferencesOf(entry));
  }

  private changedReferencesOf({
    table,
    pair,
    head,
    draft,
    fieldChanges,
  }: DraftRowEntry): ChangedReference[] {
    if (!head || !draft || !table.head || !table.draft) {
      return [];
    }

    const headReferences = this.referencesOf(table.head, head);
    const draftReferences = this.referencesOf(table.draft, draft);

    return fieldChanges.flatMap(({ fieldPath }) => {
      const pointer = pointerOfNativeFieldPath(fieldPath).toString();
      const referenced = this.changedReferenceAt(
        headReferences.get(pointer),
        draftReferences.get(pointer),
      );

      if (!referenced) {
        return [];
      }

      return [
        {
          ...referenced,
          site: {
            tableIdentity: table.identity,
            rowIdentity: pair.identity,
            pointer,
          },
        },
      ];
    });
  }

  private changedReferenceAt(
    head: ForeignKeyReference | undefined,
    draft: ForeignKeyReference | undefined,
  ): Omit<ChangedReference, 'site'> | undefined {
    if (!head || !draft || head.rowId === draft.rowId) {
      return undefined;
    }

    const identity = this.draftTables.get(draft.tableId)?.identity;

    if (
      identity === undefined ||
      identity !== this.headTables.get(head.tableId)?.identity
    ) {
      return undefined;
    }

    const referenced = this.renamable.get(identity);

    if (!referenced) {
      return undefined;
    }

    return { referenced, previousRowId: head.rowId, rowId: draft.rowId };
  }

  private referencesOf(version: TableVersion, row: Row): ReferencesByPointer {
    const references = getForeignKeyReferences(
      this.schemas.storeOf(version),
      row.data as JsonValue,
    );

    return new Map(
      references.map((reference) => [
        JsonPointer.parse(reference.legacyPath).toString(),
        reference,
      ]),
    );
  }
}

export function referenceSiteKeyOf({
  tableIdentity,
  rowIdentity,
  pointer,
}: ReferenceSite): string {
  return JSON.stringify([tableIdentity, rowIdentity, pointer]);
}

function tablesById(
  pairs: readonly TablePair[],
  versionOf: (pair: TablePair) => TableVersion | undefined,
): ReadonlyMap<string, TablePair> {
  const tables = new Map<string, TablePair>();

  for (const pair of pairs) {
    const version = versionOf(pair);

    if (version) {
      tables.set(version.id, pair);
    }
  }

  return tables;
}
