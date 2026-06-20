export interface HealthStatusInput {
  /** Milliseconds since the process started. */
  uptimeMs: number;
  /** Timestamp (ms) of the most recent crank across all tracked markets, or 0 if never. */
  mostRecentCrank: number;
  /** Number of markets currently tracked by CrankService. */
  marketsTracked: number;
  /** Milliseconds since mostRecentCrank, or Infinity if mostRecentCrank===0. */
  timeSinceLastCrank: number;
  /** Whether the liquidation scanner's polling loop is currently running. */
  liqScanRunning: boolean;
  /** Milliseconds since the liquidation scanner's last scan, or Infinity if it has never scanned. */
  timeSinceLiqScan: number;
}

/**
 * M-2: pure status-computation helper, extracted from index.ts's /health
 * handler so it can be unit tested without booting the whole module (which
 * has top-level side effects on import).
 *
 * Originally, a deployment with zero tracked markets (a fresh mainnet
 * deploy before any market is registered, or MARKETS_FILTER scoped to none
 * yet -- both explicitly supported, intentional states) would have
 * mostRecentCrank stuck at 0 forever, since there is nothing to crank.
 * Once past the startup grace period this fell through to "down"
 * permanently, even though the keeper was working exactly as designed
 * (idling, retrying discovery each cycle). Railway's platform-level
 * healthcheck was removed entirely as a workaround (commit e6b5d2a)
 * instead of fixing this root cause -- this restores the healthcheck-worthy
 * behavior by special-casing zero tracked markets as healthy.
 */
export function computeHealthStatus(
  input: HealthStatusInput,
): "ok" | "degraded" | "down" | "starting" {
  const { uptimeMs, mostRecentCrank, marketsTracked, timeSinceLastCrank, liqScanRunning, timeSinceLiqScan } = input;

  // Grace period: allow 5 minutes after startup before marking as "down".
  if (uptimeMs < 300_000 && mostRecentCrank === 0) {
    return "starting";
  }

  if (marketsTracked === 0) {
    return "ok";
  }

  let status: "ok" | "degraded" | "down";
  if (timeSinceLastCrank < 60_000) {
    status = "ok";
  } else if (timeSinceLastCrank < 300_000) {
    status = "degraded";
  } else {
    status = "down";
  }

  // GH#2025: also degrade/down if the liquidation scanner has stalled.
  if (uptimeMs >= 300_000 && liqScanRunning) {
    if (timeSinceLiqScan > 300_000 && status !== "down") {
      status = "down"; // Liquidation scan stalled >5 min
    } else if (timeSinceLiqScan > 120_000 && status === "ok") {
      status = "degraded"; // Liquidation scan stalled >2 min
    }
  }

  return status;
}
