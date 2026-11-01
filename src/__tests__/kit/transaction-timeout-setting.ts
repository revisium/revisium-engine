export function transactionTimeoutSetting(transactionTimeoutMs?: number) {
  if (transactionTimeoutMs === undefined) {
    return [];
  }

  return [() => ({ TRANSACTION_TIMEOUT: String(transactionTimeoutMs) })];
}
