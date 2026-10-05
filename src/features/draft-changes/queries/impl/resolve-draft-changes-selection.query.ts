import type {
  DraftChangeRef,
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from './build-draft-changes-catalogue.query';

export type DraftChangesChoice =
  | { kind: 'all' }
  | { kind: 'table'; tableId: string; rows?: 'all' | 'none' }
  | { kind: 'rows'; tableId: string; rowIds?: 'all' | string[] }
  | {
      kind: 'rowFields';
      tableId: string;
      rowId: string;
      paths?: 'all' | string[];
    }
  | { kind: 'schemaFields'; tableId: string; paths?: 'all' | string[] }
  | { kind: 'change'; ref: DraftChangeRef };

export interface DraftChangesSelection {
  include: DraftChangesChoice[];
  exclude?: DraftChangesChoice[];
}

export interface ResolveDraftChangesSelectionQueryData {
  catalogue: DraftChangesCatalogue;
  selection: DraftChangesSelection;
}

export interface DraftChangesSelectionBlocker {
  code:
    | 'UNKNOWN_TARGET'
    | 'AMBIGUOUS_IDENTITY'
    | 'UNKNOWN_REFERENCE'
    | 'NON_SELECTABLE'
    | 'ATOMIC_DESCENDANT'
    | 'STALE_CATALOGUE';
  message: string;
  choice?: DraftChangesChoice;
  ref?: DraftChangeRef;
}

export type DraftChangesDeniedTarget =
  | {
      kind: 'table';
      tableCreatedId: string;
      facets: Array<'lifecycle' | 'rows' | 'schemaFields' | 'views'>;
    }
  | {
      kind: 'row';
      tableCreatedId: string;
      rowCreatedId: string;
      facets: Array<'lifecycle' | 'rowFields'>;
    }
  | {
      kind: 'rowFields';
      tableCreatedId: string;
      rowCreatedId: string;
      paths: 'all' | string[];
    }
  | {
      kind: 'rowField';
      tableCreatedId: string;
      rowCreatedId: string;
      path: string;
    }
  | { kind: 'schemaField'; tableCreatedId: string; path: string }
  | { kind: 'schemaFields'; tableCreatedId: string; paths: 'all' | string[] }
  | {
      kind: 'change';
      ref: DraftChangeRef;
      target: DraftChangesCatalogueEntry['target'];
    };

export type ResolveDraftChangesSelectionResult =
  | {
      status: 'resolved';
      selected: DraftChangesCatalogueEntry[];
      excluded: DraftChangesCatalogueEntry[];
      deniedTargets: DraftChangesDeniedTarget[];
    }
  | { status: 'blocked'; blockers: DraftChangesSelectionBlocker[] };

export class ResolveDraftChangesSelectionQuery {
  constructor(public readonly data: ResolveDraftChangesSelectionQueryData) {}
}
