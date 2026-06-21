const V17_HEADER_LEN = 16;
const V17_WRAPPER_CONFIG_LEN = 432;
const V17_MARKET_GROUP_OFF = V17_HEADER_LEN + V17_WRAPPER_CONFIG_LEN;
const V17_MARKET_GROUP_ID_LEN = 32;
const V17_ENGINE_CONFIG_OFF = V17_MARKET_GROUP_OFF + V17_MARKET_GROUP_ID_LEN;

const V17_ENGINE_CONFIG_H_MIN_OFF = 38;
const V17_ENGINE_CONFIG_H_MAX_OFF = 46;
const V17_ENGINE_CONFIG_MAINTENANCE_MARGIN_BPS_OFF = 54;
const V17_ENGINE_CONFIG_LIQUIDATION_FEE_BPS_OFF = 78;

const V17_WRAPPER_MAINTENANCE_FEE_PER_SLOT_OFF = V17_HEADER_LEN + 96;

export const V17_RISK_PARAMS_MIN_DATA_LEN =
  V17_ENGINE_CONFIG_OFF + V17_ENGINE_CONFIG_LIQUIDATION_FEE_BPS_OFF + 8;

function readU64LE(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.length) {
    throw new Error(`readU64LE out of bounds at ${offset}`);
  }
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value |= BigInt(data[offset + i]!) << (8n * BigInt(i));
  }
  return value;
}

function readU128LE(data: Uint8Array, offset: number): bigint {
  const lo = readU64LE(data, offset);
  const hi = readU64LE(data, offset + 8);
  return lo | (hi << 64n);
}

/**
 * H-8: maintenanceMarginBps gates the only line that decides whether a v17
 * position is liquidatable (`marginRatioBps < maintenanceMarginBps` in
 * liquidation.ts). computeMarginRatioBps() clamps marginRatioBps to exactly
 * 0n whenever notional===0n or equity<=0n, so if maintenanceMarginBps is
 * itself 0n -- an uninitialized account, a future on-chain layout change
 * shifting this field's byte offset without a matching keeper update, or
 * corrupted/zeroed bytes -- `0n < 0n` is always false: no position in that
 * market, however underwater, is ever flagged liquidatable, silently. A
 * value >= 10_000 bps (>=100% margin requirement) is equally not a coherent
 * on-chain config and would cause the opposite failure: every position with
 * any notional would immediately appear liquidatable. Neither is a real
 * market configuration -- treat both as corrupted data and refuse to parse.
 */
export class V17RiskParamsCorruptedError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: bigint,
  ) {
    super(
      `parseV17RiskParams: ${field}=${value} is out of the valid (0, 10000) bps range ` +
        `(suspected corrupted/misaligned read)`,
    );
    this.name = "V17RiskParamsCorruptedError";
  }
}

/**
 * M-8: four fields below are hardcoded to 0n, not parsed from on-chain bytes.
 * Verified against percolator-prog's v16_program.rs (the v16/v17 engine
 * config struct) and percolator-sdk — neither defines openInterestCap,
 * adlFillCapBps, or minPositionSize anywhere; there is no on-chain byte
 * layout for them to parse. warmupPeriodSlots is a real field, but only on
 * pre-v12.15 slabs — v12.15+ (including every v17 market) replaced it with
 * hMin/hMax, which ARE parsed below. A caller must not treat any of these
 * four 0n values as a meaningful on-chain reading (e.g. "no cap"); they are
 * placeholders kept for return-type shape compatibility only.
 */
export function parseV17RiskParams(data: Uint8Array): {
  warmupPeriodSlots: bigint;
  maintenanceMarginBps: bigint;
  hMin: bigint;
  hMax: bigint;
  openInterestCap: bigint;
  maintenanceFeePerSlot: bigint;
  liquidationFeeShareBps: bigint;
  adlFillCapBps: bigint;
  minPositionSize: bigint;
} {
  if (data.length < V17_RISK_PARAMS_MIN_DATA_LEN) {
    throw new Error(
      `parseV17RiskParams: data too short — need ${V17_RISK_PARAMS_MIN_DATA_LEN} bytes, got ${data.length}`,
    );
  }

  const maintenanceMarginBps = readU64LE(
    data,
    V17_ENGINE_CONFIG_OFF + V17_ENGINE_CONFIG_MAINTENANCE_MARGIN_BPS_OFF,
  );
  if (maintenanceMarginBps <= 0n || maintenanceMarginBps >= 10_000n) {
    throw new V17RiskParamsCorruptedError("maintenanceMarginBps", maintenanceMarginBps);
  }

  return {
    warmupPeriodSlots: 0n, // not present on v17 slabs — see function doc comment
    maintenanceMarginBps,
    hMin: readU64LE(data, V17_ENGINE_CONFIG_OFF + V17_ENGINE_CONFIG_H_MIN_OFF),
    hMax: readU64LE(data, V17_ENGINE_CONFIG_OFF + V17_ENGINE_CONFIG_H_MAX_OFF),
    openInterestCap: 0n, // no on-chain field exists — see function doc comment
    maintenanceFeePerSlot: readU128LE(data, V17_WRAPPER_MAINTENANCE_FEE_PER_SLOT_OFF),
    liquidationFeeShareBps: readU64LE(
      data,
      V17_ENGINE_CONFIG_OFF + V17_ENGINE_CONFIG_LIQUIDATION_FEE_BPS_OFF,
    ),
    adlFillCapBps: 0n, // no on-chain field exists — see function doc comment
    minPositionSize: 0n, // no on-chain field exists — see function doc comment
  };
}
