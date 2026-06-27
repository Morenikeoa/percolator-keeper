import { describe, it, expect } from "vitest";
import { computeHealthStatus } from "../../src/lib/health-status.js";

function base() {
  return {
    uptimeMs: 600_000, // past the 5-minute startup grace period
    mostRecentCrank: Date.now() - 10_000,
    marketsTracked: 1,
    timeSinceLastCrank: 10_000,
    liqScanRunning: true,
    timeSinceLiqScan: 10_000,
  };
}

describe("computeHealthStatus", () => {
  it("returns 'starting' within the grace period when no crank has happened yet", () => {
    const status = computeHealthStatus({
      ...base(),
      uptimeMs: 100_000,
      mostRecentCrank: 0,
      timeSinceLastCrank: Infinity,
    });
    expect(status).toBe("starting");
  });

  // M-2: a deployment with zero tracked markets has nothing to crank by
  // design (fresh mainnet deploy before any market is registered, or
  // MARKETS_FILTER scoped to none yet) -- mostRecentCrank can never advance,
  // so without this case status would permanently fall through to "down"
  // after the startup grace period.
  it("returns 'ok' when marketsTracked===0, even well past the startup grace period", () => {
    const status = computeHealthStatus({
      uptimeMs: 24 * 3_600_000, // a full day of uptime
      mostRecentCrank: 0,
      marketsTracked: 0,
      timeSinceLastCrank: Infinity,
      liqScanRunning: true,
      timeSinceLiqScan: 10_000,
    });
    expect(status).toBe("ok");
  });

  it("returns 'ok' for a recently-cranked market", () => {
    expect(computeHealthStatus(base())).toBe("ok");
  });

  it("returns 'degraded' when the most recent crank is between 1 and 5 minutes old", () => {
    const status = computeHealthStatus({ ...base(), timeSinceLastCrank: 120_000 });
    expect(status).toBe("degraded");
  });

  it("returns 'down' when the most recent crank is more than 5 minutes old", () => {
    const status = computeHealthStatus({ ...base(), timeSinceLastCrank: 400_000 });
    expect(status).toBe("down");
  });

  it("downgrades 'ok' to 'degraded' when the liquidation scanner has stalled 2-5 minutes", () => {
    const status = computeHealthStatus({ ...base(), timeSinceLiqScan: 150_000 });
    expect(status).toBe("degraded");
  });

  it("downgrades to 'down' when the liquidation scanner has stalled more than 5 minutes", () => {
    const status = computeHealthStatus({ ...base(), timeSinceLiqScan: 400_000 });
    expect(status).toBe("down");
  });

  it("does not apply the liquidation-scan stall check before the startup grace period elapses", () => {
    const status = computeHealthStatus({
      ...base(),
      uptimeMs: 100_000,
      timeSinceLiqScan: 400_000,
    });
    expect(status).toBe("ok");
  });

  it("does not apply the liquidation-scan stall check when the scanner isn't running", () => {
    const status = computeHealthStatus({
      ...base(),
      liqScanRunning: false,
      timeSinceLiqScan: 400_000,
    });
    expect(status).toBe("ok");
  });

  // BUG-109: an oracle outage already pauses affected markets (visible on
  // /pause-status via stalePausedMarkets), but that signal never reached
  // /health's top-level status before this fix.
  describe("BUG-109: oracle staleness gates status", () => {
    it("is unaffected when stalePausedMarketCount is omitted (default 0)", () => {
      expect(computeHealthStatus(base())).toBe("ok");
    });

    it("is unaffected when stalePausedMarketCount is explicitly 0", () => {
      const status = computeHealthStatus({ ...base(), stalePausedMarketCount: 0 });
      expect(status).toBe("ok");
    });

    it("downgrades 'ok' to 'degraded' when some (but not all) tracked markets are stale-paused", () => {
      const status = computeHealthStatus({
        ...base(),
        marketsTracked: 5,
        stalePausedMarketCount: 2,
      });
      expect(status).toBe("degraded");
    });

    it("escalates to 'down' when every tracked market is stale-paused", () => {
      const status = computeHealthStatus({
        ...base(),
        marketsTracked: 3,
        stalePausedMarketCount: 3,
      });
      expect(status).toBe("down");
    });

    it("does not de-escalate an already-'down' status from a partial oracle outage", () => {
      const status = computeHealthStatus({
        ...base(),
        timeSinceLastCrank: 400_000, // already "down" on crank staleness alone
        marketsTracked: 5,
        stalePausedMarketCount: 1,
      });
      expect(status).toBe("down");
    });

    it("does not escalate to 'down' from a total oracle outage when marketsTracked is 0", () => {
      // stalePausedMarketCount can't legitimately exceed marketsTracked, but
      // marketsTracked===0 must keep short-circuiting to "ok" regardless.
      const status = computeHealthStatus({
        ...base(),
        marketsTracked: 0,
        timeSinceLastCrank: Infinity,
        stalePausedMarketCount: 0,
      });
      expect(status).toBe("ok");
    });
  });
});
