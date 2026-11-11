export const REQUIRED_REASON_CODES = [
  'structureBoundData',
  'wholeRowUnit',
  'atomicValue',
  'referencedRowMissing',
  'referrerStillReferences',
  'idOccupied',
  'referencedTableMissing',
] as const;

export type RequiredReasonCode = (typeof REQUIRED_REASON_CODES)[number];

export const REASON_SITE_KINDS = [
  'selector',
  'row',
  'schema',
  'migration',
  'rowId',
  'tableId',
] as const;

export type ReasonSiteKind = (typeof REASON_SITE_KINDS)[number];

// The kind fixes what the fields mean (SPEC §5.1): public ids at every site but
// `migration` and a `tableId` site with `migrationId`, which carry the ids of
// the ledger at that step.
export type ReasonSite =
  | {
      readonly kind: 'selector';
      readonly tableId: string;
      readonly rowId?: string;
      readonly path?: string;
    }
  | {
      readonly kind: 'row';
      readonly tableId: string;
      readonly rowId: string;
      readonly path: string;
    }
  | { readonly kind: 'schema'; readonly tableId: string }
  | {
      readonly kind: 'migration';
      readonly tableId: string;
      readonly migrationId: string;
    }
  | { readonly kind: 'rowId'; readonly tableId: string; readonly rowId: string }
  | {
      readonly kind: 'tableId';
      readonly tableId: string;
      readonly migrationId?: string;
    };

export const REFERENCED_ENTITY_KINDS = ['row', 'table'] as const;

export type ReferencedEntityKind = (typeof REFERENCED_ENTITY_KINDS)[number];

export type ReferencedEntity =
  | { readonly kind: 'row'; readonly tableId: string; readonly rowId: string }
  | { readonly kind: 'table'; readonly tableId: string };

export const CAUSE_ROLES = [
  'referrer',
  'remover',
  'taker',
  'occupant',
] as const;

export type CauseRole = (typeof CAUSE_ROLES)[number];

export interface CatalogueCause {
  readonly unitKey: string;
  readonly role: CauseRole;
}

export interface CatalogueReason {
  readonly code: RequiredReasonCode;
  readonly because: string;
  readonly site: ReasonSite;
  readonly references?: ReferencedEntity;
  readonly cause?: CatalogueCause;
}

export interface SitePosition {
  readonly tableId: string;
  readonly rowId?: string;
  readonly path?: string;
}

export function causeOf(
  unitKey: string | undefined,
  role: CauseRole,
): CatalogueCause | undefined {
  if (unitKey === undefined) {
    return undefined;
  }

  return { unitKey, role };
}

export function withCause(
  reason: CatalogueReason,
  cause: CatalogueCause | undefined,
): CatalogueReason {
  if (cause === undefined) {
    return reason;
  }

  return { ...reason, cause };
}

// The table, row and pointer a blocker raised at this site names.
export function positionOf(site: ReasonSite): SitePosition {
  switch (site.kind) {
    case 'selector':
    case 'row':
      return { tableId: site.tableId, rowId: site.rowId, path: site.path };
    case 'rowId':
      return { tableId: site.tableId, rowId: site.rowId };
    case 'schema':
    case 'migration':
    case 'tableId':
      return { tableId: site.tableId };
  }
}
