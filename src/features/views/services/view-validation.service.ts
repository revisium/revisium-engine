import { BadRequestException, Injectable } from '@nestjs/common';
import {
  getDBJsonPathByJsonSchemaStore,
  traverseStore,
} from '@revisium/schema-toolkit/lib';
import { JsonSchema } from '@revisium/schema-toolkit/types';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';
import { VALIDATE_URL_LIKE_ID_ERROR_MESSAGE } from 'src/features/share/utils/validateUrlLikeId/validateUrlLikeId';
import {
  TableViewsData,
  View,
  ViewFilterGroup,
} from 'src/features/views/types';

const DATA_FIELD_PREFIX = 'data.';
const DB_PATH_PREFIX = '$.';
const VIEW_ID_PATTERN = /^(?!__)[a-zA-Z_][a-zA-Z0-9-_]*$/;
const VIEW_ID_MAX_LENGTH = 64;

export interface ViewValidationFailure {
  category: 'data' | 'identity';
  message: string;
  viewId?: string;
  component?: 'columns' | 'sorts' | 'filters' | 'defaultViewId';
  path?: string;
}

interface ViewFieldFailure {
  viewId: string;
  component: 'columns' | 'sorts' | 'filters';
  path: string;
}

const SYSTEM_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'createdId',
  'versionId',
  'publishedAt',
  'hash',
  'schemaHash',
]);

@Injectable()
export class ViewValidationService {
  private readonly viewsSchemaHash: string;

  constructor(
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
    private readonly jsonSchemaStoreService: JsonSchemaStoreService,
    private readonly jsonSchemaValidator: JsonSchemaValidatorService,
  ) {
    this.viewsSchemaHash =
      this.jsonSchemaValidator.getSchemaHash(tableViewsSchema);
  }

  public async validateViewsData(data: unknown): Promise<TableViewsData> {
    const viewsData = await this.validateDocumentShape(data);
    this.validateViewIdentities(viewsData);
    return viewsData;
  }

  public async validateViewsFields(
    revisionId: string,
    tableId: string,
    viewsData: TableViewsData,
  ): Promise<void> {
    const { schema } = await this.shareTransactionalQueries.getTableSchema(
      revisionId,
      tableId,
    );

    this.validateSuppliedSchemaFields(tableId, viewsData, schema);
  }

  public validateSuppliedSchemaFields(
    tableId: string,
    viewsData: TableViewsData,
    schema: JsonSchema,
  ): void {
    const invalidFields = this.findInvalidViewFields(viewsData, schema);
    this.rejectInvalidViewFields(tableId, invalidFields);
  }

  public describeValidationFailure(
    error: unknown,
  ): ViewValidationFailure | undefined {
    if (!(error instanceof BadRequestException)) {
      return undefined;
    }
    const cause = error.cause;
    if (
      cause &&
      typeof cause === 'object' &&
      'kind' in cause &&
      cause.kind === 'viewValidation' &&
      'category' in cause &&
      (cause.category === 'data' || cause.category === 'identity') &&
      'message' in cause &&
      typeof cause.message === 'string'
    ) {
      const failure = cause as ViewValidationFailure;
      return {
        category: failure.category,
        message: failure.message,
        viewId: failure.viewId,
        component: failure.component,
        path: failure.path,
      };
    }
    const firstError: unknown = Array.isArray(cause) ? cause[0] : undefined;
    let path: string | undefined;
    if (
      firstError &&
      typeof firstError === 'object' &&
      'instancePath' in firstError &&
      typeof firstError.instancePath === 'string'
    ) {
      path = firstError.instancePath || '/';
    }
    return { category: 'data', message: error.message, path };
  }

  private findInvalidViewFields(
    viewsData: TableViewsData,
    schema: JsonSchema,
  ): ViewFieldFailure[] {
    const validFields = this.extractValidFieldsFromSchema(schema);
    const invalidFields: ViewFieldFailure[] = [];

    for (const view of viewsData.views) {
      const viewInvalidFields = this.validateViewFields(view, validFields);
      invalidFields.push(...viewInvalidFields);
    }

    return invalidFields;
  }

  private rejectInvalidViewFields(
    tableId: string,
    invalidFields: ViewFieldFailure[],
  ): void {
    if (invalidFields.length > 0) {
      const uniqueInvalidFields = [
        ...new Set(invalidFields.map(({ path }) => path)),
      ];
      this.throwValidationFailure(
        `Invalid fields in views: ${uniqueInvalidFields.join(', ')}. These fields do not exist in table "${tableId}".`,
        'data',
        invalidFields[0],
      );
    }
  }

  private async validateDocumentShape(data: unknown): Promise<TableViewsData> {
    const { result, errors } = await this.jsonSchemaValidator.validate(
      data,
      tableViewsSchema,
      this.viewsSchemaHash,
    );
    if (!result) {
      throw new BadRequestException('Invalid views data', { cause: errors });
    }
    return data as TableViewsData;
  }

  private validateViewIdentities(viewsData: TableViewsData): void {
    const ids = viewsData.views.map(({ id }) => id);
    const uniqueIds = new Set(ids);
    this.validateDefaultView(viewsData, uniqueIds);
    this.validateUniqueViewIds(ids, uniqueIds);
    this.validateViewIds(ids);
  }

  private validateDefaultView(
    viewsData: TableViewsData,
    viewIds: Set<string>,
  ): void {
    if (!viewIds.has(viewsData.defaultViewId)) {
      this.throwValidationFailure(
        `Default view "${viewsData.defaultViewId}" does not exist in views list`,
        'identity',
        { component: 'defaultViewId', path: '/defaultViewId' },
      );
    }
  }

  private validateUniqueViewIds(
    viewIds: string[],
    uniqueIds: Set<string>,
  ): void {
    if (uniqueIds.size !== viewIds.length) {
      this.throwValidationFailure('View IDs must be unique', 'identity');
    }
  }

  private validateViewIds(viewIds: string[]): void {
    for (const id of viewIds) {
      if (
        id.length < 1 ||
        id.length > VIEW_ID_MAX_LENGTH ||
        !VIEW_ID_PATTERN.test(id)
      ) {
        this.throwValidationFailure(
          `View ID "${id}" is invalid. ${VALIDATE_URL_LIKE_ID_ERROR_MESSAGE}`,
          'identity',
          { viewId: id },
        );
      }
    }
  }

  private throwValidationFailure(
    message: string,
    category: ViewValidationFailure['category'],
    location: Omit<ViewValidationFailure, 'message' | 'category'> = {},
  ): never {
    throw new BadRequestException(message, {
      cause: { kind: 'viewValidation', category, message, ...location },
    });
  }

  private validateViewFields(
    view: View,
    validFields: Set<string>,
  ): ViewFieldFailure[] {
    const invalidFields: ViewFieldFailure[] = [];

    if (view.columns) {
      for (const column of view.columns) {
        if (!this.isValidField(column.field, validFields)) {
          invalidFields.push({
            viewId: view.id,
            component: 'columns',
            path: column.field,
          });
        }
      }
    }

    if (view.sorts) {
      for (const sort of view.sorts) {
        if (!this.isValidField(sort.field, validFields)) {
          invalidFields.push({
            viewId: view.id,
            component: 'sorts',
            path: sort.field,
          });
        }
      }
    }

    if (view.filters) {
      invalidFields.push(
        ...this.validateFilterGroupFields(view.id, view.filters, validFields),
      );
    }

    return invalidFields;
  }

  private validateFilterGroupFields(
    viewId: string,
    filterGroup: ViewFilterGroup,
    validFields: Set<string>,
  ): ViewFieldFailure[] {
    const invalidFields: ViewFieldFailure[] = [];

    if (filterGroup.conditions) {
      for (const condition of filterGroup.conditions) {
        if (!this.isValidField(condition.field, validFields)) {
          invalidFields.push({
            viewId,
            component: 'filters',
            path: condition.field,
          });
        }
      }
    }

    if (filterGroup.groups) {
      for (const nestedGroup of filterGroup.groups) {
        invalidFields.push(
          ...this.validateFilterGroupFields(viewId, nestedGroup, validFields),
        );
      }
    }

    return invalidFields;
  }

  private isValidField(field: string, validFields: Set<string>): boolean {
    if (SYSTEM_FIELDS.has(field)) {
      return true;
    }

    if (field.startsWith(DATA_FIELD_PREFIX)) {
      const fieldName = field.slice(DATA_FIELD_PREFIX.length);
      return validFields.has(fieldName);
    }

    return false;
  }

  private extractValidFieldsFromSchema(schema: unknown): Set<string> {
    const validFields = new Set<string>();

    if (!schema || typeof schema !== 'object') {
      return validFields;
    }

    const schemaStore = this.jsonSchemaStoreService.create(
      schema as JsonSchema,
    );

    traverseStore(schemaStore, (item) => {
      if (!item.name) {
        return;
      }

      const dbPath = getDBJsonPathByJsonSchemaStore(item);
      const fieldPath = dbPath.startsWith(DB_PATH_PREFIX)
        ? dbPath.slice(DB_PATH_PREFIX.length)
        : dbPath;

      validFields.add(fieldPath);
    });

    return validFields;
  }
}
