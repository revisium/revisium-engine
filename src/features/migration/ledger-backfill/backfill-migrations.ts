import type {
  InitMigration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import { NativeIdSequence } from 'src/features/share/ledger/native-migration-id';
import type { OrderedLedger } from './backfill-order';

export type BackfillMigration = InitMigration | UpdateMigration;

export function backfillMigrationsOf({
  inits,
  updates,
}: OrderedLedger): BackfillMigration[] {
  const ids = new NativeIdSequence({ id: null, publishedAt: null });

  return [
    ...inits.map(
      ({ tableId, schema }): InitMigration => ({
        changeType: 'init',
        tableId,
        id: ids.next(),
        hash: objectHash(schema),
        schema,
      }),
    ),
    ...updates.map(
      ({ tableId, headSchema, patches }): UpdateMigration => ({
        changeType: 'update',
        tableId,
        id: ids.next(),
        hash: objectHash(headSchema),
        patches,
      }),
    ),
  ];
}
