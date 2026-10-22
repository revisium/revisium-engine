import { BadRequestException, Injectable } from '@nestjs/common';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { ViewsMigrator } from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import type { TablePair } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { replaySchemaHistory } from 'src/features/partial-changes-poc/structure/table-structure';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { ViewValidationService } from 'src/features/views/services';
import type { TableViewsData } from 'src/features/views/types';

@Injectable()
export class ViewsProjection {
  readonly migrator: ViewsMigrator = (views, pair) =>
    this.migrateThroughHistory(views, pair);

  constructor(
    private readonly viewsMigration: ViewsMigrationService,
    private readonly viewValidation: ViewValidationService,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
  ) {}

  async fits(
    views: TableViewsData,
    revisionId: string,
    tableId: string,
  ): Promise<boolean> {
    try {
      await this.viewValidation.validateViewsData(views);
      await this.viewValidation.validateViewsFields(revisionId, tableId, views);
      return true;
    } catch (error) {
      if (error instanceof BadRequestException) {
        return false;
      }
      throw error;
    }
  }

  private migrateThroughHistory(
    views: TableViewsData,
    pair: TablePair,
  ): TableViewsData | undefined {
    const history = pair.structure?.pendingHistory;
    if (!history || !pair.headSchema) {
      return undefined;
    }

    try {
      let schema: JsonSchema | undefined = pair.headSchema;
      let migrated = views;
      for (const entry of history) {
        if (!schema) {
          return undefined;
        }
        migrated = this.viewsMigration.migrateViews({
          viewsData: migrated,
          patches: entry.patches,
          previousSchema: schema,
        });
        schema = replaySchemaHistory(
          schema,
          [entry],
          this.jsonSchemaStore.refs,
        );
      }
      return migrated;
    } catch {
      return undefined;
    }
  }
}
