import { Address } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLD_FEE_CAP_STROOPS,
  DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
  DEFAULT_WARM_FEE_CAP_STROOPS,
  normalizePolicyContracts,
  normalizePolicyEventTopics,
  resolveStellarFeeCeiling,
} from "../../src/exact/facilitator/policy";

describe("resolveStellarFeeCeiling", () => {
  it("keeps the 50,000 stroop ceiling when no profile is selected", () => {
    expect(resolveStellarFeeCeiling()).toEqual({
      capStroops: DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
    });
    expect(DEFAULT_MAX_TRANSACTION_FEE_STROOPS).toBe(50_000);
  });

  it("selects the warm cap above the 324,039 stroop observation and the cold cap above 5,710,000", () => {
    const warm = resolveStellarFeeCeiling({ feeProfile: "warm" });
    const cold = resolveStellarFeeCeiling({ feeProfile: "cold" });

    expect(warm).toEqual({ capStroops: DEFAULT_WARM_FEE_CAP_STROOPS, feeProfile: "warm" });
    expect(warm.capStroops).toBeGreaterThan(324_039);
    expect(cold).toEqual({ capStroops: DEFAULT_COLD_FEE_CAP_STROOPS, feeProfile: "cold" });
    expect(cold.capStroops).toBeGreaterThan(5_710_000);
    expect(warm.capStroops).toBeLessThan(5_710_000);
  });

  it("lets an explicit ceiling replace the profile cap", () => {
    expect(
      resolveStellarFeeCeiling({ feeProfile: "cold", maxTransactionFeeStroops: 42_000 }),
    ).toEqual({ capStroops: 42_000, feeProfile: "cold" });
  });

  it("uses an operator cap for the selected profile only", () => {
    expect(resolveStellarFeeCeiling({ feeProfile: "warm", warmCapStroops: 400_000 })).toEqual({
      capStroops: 400_000,
      feeProfile: "warm",
    });
    expect(resolveStellarFeeCeiling({ feeProfile: "cold", coldCapStroops: 5_800_000 })).toEqual({
      capStroops: 5_800_000,
      feeProfile: "cold",
    });
    expect(resolveStellarFeeCeiling({ warmCapStroops: 400_000 }).capStroops).toBe(
      DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
    );
  });

  it("rejects an unknown profile and a non-positive cap", () => {
    expect(() => resolveStellarFeeCeiling({ feeProfile: "hot" as "warm" })).toThrow(
      /Unknown fee profile/,
    );
    expect(() => resolveStellarFeeCeiling({ warmCapStroops: 0 })).toThrow(/warmCapStroops/);
    expect(() => resolveStellarFeeCeiling({ coldCapStroops: -5 })).toThrow(/coldCapStroops/);
    expect(() => resolveStellarFeeCeiling({ maxTransactionFeeStroops: 1.2 })).toThrow(
      /maxTransactionFeeStroops/,
    );
  });
});

describe("policy allowlist normalization", () => {
  const policy = Address.contract(Buffer.alloc(32, 7)).toString();

  it("trims, drops blanks, and dedupes contract ids", () => {
    expect(normalizePolicyContracts([` ${policy}`, "", policy])).toEqual([policy]);
    expect(normalizePolicyContracts(undefined)).toEqual([]);
  });

  it("rejects a contract id that is not a C address", () => {
    expect(() => normalizePolicyContracts(["G".repeat(56)])).toThrow(
      /not a Stellar contract address/,
    );
  });

  it("rejects balance-moving topics, including a different case", () => {
    expect(normalizePolicyEventTopics(undefined)).toEqual([]);
    expect(
      normalizePolicyEventTopics([" spending_limit_enforced ", "spending_limit_enforced"]),
    ).toEqual(["spending_limit_enforced"]);
    for (const topic of [
      "transfer",
      "mint",
      "burn",
      "clawback",
      "approve",
      "set_authorized",
      "Mint",
    ]) {
      expect(() => normalizePolicyEventTopics([topic])).toThrow(/balance-moving/);
    }
  });
});
