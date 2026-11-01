import type { Row } from 'src/engine-prisma-types';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { distinctRows } from 'src/features/partial-changes/catalogue/catalogue-tables';
import { differInContent } from 'src/features/partial-changes/catalogue/row-differences';
import { sharedSchemaUnitKey } from 'src/features/partial-changes/catalogue/unit-key';
import type {
  RevisionRows,
  RowPair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export function buildSharedSchemaUnits(
  sharedSchemaRows: RevisionRows,
): CatalogueUnit[] {
  return pairsByIdentity(sharedSchemaRows).flatMap(
    ({ identity, head, draft }) => {
      const sharedSchema = draft ?? head;

      if (!sharedSchema || !sharedSchemaDiffers(head, draft)) {
        return [];
      }

      return [
        {
          key: sharedSchemaUnitKey(identity),
          tableIdentities: [],
          rowIdentities: [],
          systemRows: distinctRows([head, draft]),
          unit: { kind: 'sharedSchema', tableId: sharedSchema.id },
        },
      ];
    },
  );
}

function pairsByIdentity(rows: RevisionRows): RowPair[] {
  const head = new Map(rows.head.map((row) => [row.createdId, row]));
  const draft = new Map(rows.draft.map((row) => [row.createdId, row]));
  const identities = new Set([...head.keys(), ...draft.keys()]);

  return [...identities].map((identity) => ({
    identity,
    head: head.get(identity),
    draft: draft.get(identity),
  }));
}

function sharedSchemaDiffers(
  head: Row | undefined,
  draft: Row | undefined,
): boolean {
  if (!head || !draft) {
    return true;
  }

  return differInContent(head, draft);
}
