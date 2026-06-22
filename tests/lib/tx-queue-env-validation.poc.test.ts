import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@percolatorct/shared", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../src/lib/metrics.js", () => ({
  txQueueWaitSeconds: { observe: vi.fn() },
  txQueuePending: { set: vi.fn() },
  txQueueActive: { set: vi.fn() },
  txQueueCompletedTotal: { inc: vi.fn() },
  txQueueFailedTotal: { inc: vi.fn() },
}));

import { TxQueue } from "../../src/lib/tx-queue.js";

describe("TxQueue env validation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("falls back for invalid concurrency and cap values while allowing zero-ms intervals", async () => {
    process.env.TX_QUEUE_CRANK_CONCURRENCY = "0";
    process.env.TX_QUEUE_CRANK_INTERVAL_CAP = "-1";
    process.env.TX_QUEUE_CRANK_INTERVAL_MS = "0";

    const queue = new TxQueue();

    await expect(queue.enqueue("crank", async () => "ok")).resolves.toBe("ok");
  });
});
