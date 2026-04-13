export interface MigrationOptions {
  /** Row count threshold for async migration. Default: 1000. */
  threshold?: number;
  /** Worker mode. Default: 'inline'. */
  workerMode?: 'inline' | 'polling' | 'disabled';
  /** Rows per batch. Default: 1000 */
  batchSize?: number;
  /** Polling interval in ms (polling mode only). Default: 5000 */
  pollIntervalMs?: number;
  /** Heartbeat interval in ms (polling mode). Default: 30000 */
  heartbeatIntervalMs?: number;
  /** Stale lock timeout in ms. Default: 60000 */
  lockTimeoutMs?: number;
  /** Auto-abort if no progress for this duration in ms. Default: 600000 (10 min) */
  stallTimeoutMs?: number;
  /** Max retry count on failure. Default: 3 */
  maxRetries?: number;
}
