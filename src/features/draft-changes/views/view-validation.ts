import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateViewBlocker } from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { ViewValidationService } from 'src/features/views/services/view-validation.service';
import type { TableViewsData } from 'src/features/views/types';

export async function validateStoredViewDocument(
  validator: ViewValidationService,
  tableCreatedId: string,
  tableId: string,
  value: unknown,
): Promise<
  | { status: 'valid'; document: TableViewsData }
  | { status: 'blocked'; blocker: CandidateViewBlocker }
> {
  try {
    return {
      status: 'valid',
      document: await validator.validateViewsData(value),
    };
  } catch (error) {
    const failure = validator.describeValidationFailure(error);
    if (!failure) {
      throw error;
    }
    return {
      status: 'blocked',
      blocker: {
        code:
          failure.category === 'identity'
            ? 'INVALID_VIEW_IDENTITY'
            : 'INVALID_VIEW_DATA',
        message: failure.message,
        tableCreatedId,
        viewId: failure.viewId,
        component: failure.component,
        path: failure.path,
      },
    };
  }
}

export function validateViewSchemaFields(
  validator: ViewValidationService,
  role: 'head' | 'draft',
  state: DraftRevisionState,
  tableCreatedId: string,
  tableId: string,
  document: TableViewsData,
): CandidateViewBlocker | undefined {
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const schemaRow = schemaTable?.rows.find(({ id }) => id === tableId);
  if (!schemaRow) {
    return {
      code: 'INVALID_VIEW_DATA',
      message: `The '${role}' schema is missing for views on table '${tableId}'.`,
      tableCreatedId,
    };
  }
  try {
    validator.validateSuppliedSchemaFields(
      tableId,
      document,
      schemaRow.data as unknown as JsonSchema,
    );
    return undefined;
  } catch (error) {
    const failure = validator.describeValidationFailure(error);
    if (!failure) {
      throw error;
    }
    return {
      code:
        failure.category === 'identity'
          ? 'INVALID_VIEW_IDENTITY'
          : 'INVALID_VIEW_DATA',
      message: failure.message,
      tableCreatedId,
      viewId: failure.viewId,
      component: failure.component,
      path: failure.path,
    };
  }
}
