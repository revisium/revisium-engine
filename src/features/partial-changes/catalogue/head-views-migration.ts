import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { PendingSchemaHistory } from 'src/features/partial-changes/structure/pending-schema-history';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import type { ViewsMigrationService } from 'src/features/share/views-migration.service';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import type { TableViewsData } from 'src/features/views/types';

export class HeadViewsMigration {
  constructor(
    private readonly viewsMigration: ViewsMigrationService,
    private readonly rules: NativeSchemaRules,
  ) {}

  public migrate(
    views: TableViewsData,
    headSchema: JsonSchema,
    pendingHistory: PendingSchemaHistory,
  ): TableViewsData | undefined {
    if (!pendingHistory.extendsHead) {
      return undefined;
    }

    try {
      return this.migrateThrough(views, headSchema, pendingHistory.entries);
    } catch {
      return undefined;
    }
  }

  private migrateThrough(
    views: TableViewsData,
    headSchema: JsonSchema,
    entries: readonly HistoryPatches[],
  ): TableViewsData {
    let migrated = views;
    let previousSchema = headSchema;

    for (const { patches } of entries) {
      migrated = this.viewsMigration.migrateViews({
        viewsData: migrated,
        patches,
        previousSchema,
      });
      previousSchema = this.rules.patchedSchema(previousSchema, patches);
    }

    return migrated;
  }
}
