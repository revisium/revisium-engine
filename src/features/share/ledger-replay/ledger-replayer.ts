import { Injectable } from '@nestjs/common';
import type { Migration } from '@revisium/schema-toolkit/types';
import {
  type LedgerReplayInput,
  replayLedger,
  type ReplayedLedger,
} from 'src/features/share/ledger-replay/ledger-replay';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';

export type LedgerReplayOptions = Pick<
  LedgerReplayInput,
  'schemas' | 'recordTrail'
>;

@Injectable()
export class LedgerReplayer {
  constructor(private readonly rules: NativeSchemaRules) {}

  public replay(
    ledger: readonly Migration[],
    options: LedgerReplayOptions = {},
  ): ReplayedLedger {
    return replayLedger({ ledger, rules: this.rules, ...options });
  }
}
