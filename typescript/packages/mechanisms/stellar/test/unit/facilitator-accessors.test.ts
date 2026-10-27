import { Address } from "@stellar/stellar-sdk";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STELLAR_TESTNET_CAIP2 } from "../../src/constants";
import {
  DEFAULT_COLD_FEE_CAP_STROOPS,
  DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
  DEFAULT_WARM_FEE_CAP_STROOPS,
} from "../../src/exact/facilitator/policy";
import { ExactStellarScheme } from "../../src/exact/facilitator/scheme";
import { createEd25519Signer } from "../../src/signer";
import * as stellarUtils from "../../src/utils";

vi.mock("../../src/utils", async () => {
  const actual = await vi.importActual<typeof stellarUtils>("../../src/utils");
  return {
    ...actual,
    getRpcClient: vi.fn(),
  };
});

describe("ExactStellarScheme - getExtra", () => {
  const mockRpcClient = {
    getLatestLedger: vi.fn(),
  };
  let scheme: ExactStellarScheme;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stellarUtils.getRpcClient).mockReturnValue(mockRpcClient as never);
  });

  it("should return areFeesSponsored", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );

    scheme = new ExactStellarScheme([signer]);

    const result = scheme.getExtra(STELLAR_TESTNET_CAIP2);

    expect(result).toEqual({
      areFeesSponsored: true,
      maxTransactionFeeStroops: DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
    });
    expect(mockRpcClient.getLatestLedger).not.toHaveBeenCalled();
  });

  it("should return consistent areFeesSponsored on each call", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );

    scheme = new ExactStellarScheme([signer]);

    const result1 = scheme.getExtra(STELLAR_TESTNET_CAIP2);
    expect(result1).toEqual({
      areFeesSponsored: true,
      maxTransactionFeeStroops: DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
    });

    const result2 = scheme.getExtra(STELLAR_TESTNET_CAIP2);
    expect(result2).toEqual({
      areFeesSponsored: true,
      maxTransactionFeeStroops: DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
    });

    expect(mockRpcClient.getLatestLedger).not.toHaveBeenCalled();
  });

  it("should use custom areFeesSponsored", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );

    scheme = new ExactStellarScheme([signer], { areFeesSponsored: false });

    const result = scheme.getExtra(STELLAR_TESTNET_CAIP2);
    expect(result).toEqual({
      areFeesSponsored: false,
      maxTransactionFeeStroops: DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
    });
  });

  it("should return consistent areFeesSponsored with multiple signers", () => {
    const signer1 = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );
    const signer2 = createEd25519Signer(
      "SA6LFVPCYMDQILBRXQ2B2HRPK6DV2TX4FTQQQHWFPSCSY4H2RTCD3XAK",
      STELLAR_TESTNET_CAIP2,
    );

    scheme = new ExactStellarScheme([signer1, signer2]);

    // Call getExtra multiple times to ensure consistency
    for (let i = 0; i < 10; i++) {
      const result = scheme.getExtra(STELLAR_TESTNET_CAIP2);
      expect(result).toEqual({
        areFeesSponsored: true,
        maxTransactionFeeStroops: DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
      });
    }

    expect(mockRpcClient.getLatestLedger).not.toHaveBeenCalled();
  });

  it("publishes a fee profile, an explicit ceiling, and the policy allowlist", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );
    const policy = Address.contract(Buffer.alloc(32, 7)).toString();

    const warm = new ExactStellarScheme([signer], {
      feeProfile: "warm",
      policyContracts: [policy, ` ${policy}`],
      policyEventTopics: ["spending_limit_enforced"],
    });
    expect(warm.maxTransactionFeeStroops).toBe(DEFAULT_WARM_FEE_CAP_STROOPS);
    expect(warm.getExtra(STELLAR_TESTNET_CAIP2)).toEqual({
      areFeesSponsored: true,
      feeProfile: "warm",
      maxTransactionFeeStroops: DEFAULT_WARM_FEE_CAP_STROOPS,
      policyEventContracts: [policy],
      policyEventTopics: ["spending_limit_enforced"],
    });

    const overridden = new ExactStellarScheme([signer], {
      feeProfile: "warm",
      maxTransactionFeeStroops: 123_456,
    });
    expect(overridden.feeProfile).toBe("warm");
    expect(overridden.maxTransactionFeeStroops).toBe(123_456);
    expect(overridden.getExtra(STELLAR_TESTNET_CAIP2)).toMatchObject({
      feeProfile: "warm",
      maxTransactionFeeStroops: 123_456,
    });

    const cold = new ExactStellarScheme([signer], { feeProfile: "cold" });
    expect(cold.maxTransactionFeeStroops).toBe(DEFAULT_COLD_FEE_CAP_STROOPS);
    expect(cold.getExtra(STELLAR_TESTNET_CAIP2)).not.toHaveProperty("policyEventContracts");
  });

  it("rejects a balance-moving topic and a contract id that is not a C address", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );

    expect(() => new ExactStellarScheme([signer], { policyEventTopics: ["transfer"] })).toThrow(
      /balance-moving/,
    );
    expect(() => new ExactStellarScheme([signer], { policyEventTopics: ["Approve"] })).toThrow(
      /balance-moving/,
    );
    expect(() => new ExactStellarScheme([signer], { policyContracts: ["not-a-contract"] })).toThrow(
      /not a Stellar contract address/,
    );
  });
});

describe("ExactStellarScheme - getSigners", () => {
  const mockRpcClient = {
    getLatestLedger: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stellarUtils.getRpcClient).mockReturnValue(mockRpcClient as never);
  });

  it("should return all signer addresses with a single signer", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );

    const scheme = new ExactStellarScheme([signer]);
    const signers = scheme.getSigners(STELLAR_TESTNET_CAIP2);

    expect(signers).toEqual([signer.address]);
  });

  it("should return all signer addresses with multiple signers", () => {
    const signer1 = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );
    const signer2 = createEd25519Signer(
      "SA6LFVPCYMDQILBRXQ2B2HRPK6DV2TX4FTQQQHWFPSCSY4H2RTCD3XAK",
      STELLAR_TESTNET_CAIP2,
    );

    const scheme = new ExactStellarScheme([signer1, signer2]);
    const signers = scheme.getSigners(STELLAR_TESTNET_CAIP2);

    expect(signers).toHaveLength(2);
    expect(signers).toContain(signer1.address);
    expect(signers).toContain(signer2.address);
  });

  it("should include feeBumpSigner address when configured", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );
    const feeBumpSigner = createEd25519Signer(
      "SA6LFVPCYMDQILBRXQ2B2HRPK6DV2TX4FTQQQHWFPSCSY4H2RTCD3XAK",
      STELLAR_TESTNET_CAIP2,
    );

    const scheme = new ExactStellarScheme([signer], { feeBumpSigner });
    const signers = scheme.getSigners(STELLAR_TESTNET_CAIP2);

    expect(signers).toHaveLength(2);
    expect(signers).toContain(signer.address);
    expect(signers).toContain(feeBumpSigner.address);
  });

  it("should not duplicate feeBumpSigner if it is also a regular signer", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );

    const scheme = new ExactStellarScheme([signer], { feeBumpSigner: signer });
    const signers = scheme.getSigners(STELLAR_TESTNET_CAIP2);

    expect(signers).toHaveLength(1);
    expect(signers).toEqual([signer.address]);
  });

  it("should include feeBumpSigner with multiple regular signers", () => {
    const signer1 = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );
    const signer2 = createEd25519Signer(
      "SA6LFVPCYMDQILBRXQ2B2HRPK6DV2TX4FTQQQHWFPSCSY4H2RTCD3XAK",
      STELLAR_TESTNET_CAIP2,
    );
    const feeBumpSigner = createEd25519Signer(
      "SACGSSH2Y7Q6P6BK3BBKGH5Z2RDSQQGD2XHOCDYQN7N6BU37HE2OLKMD",
      STELLAR_TESTNET_CAIP2,
    );

    const scheme = new ExactStellarScheme([signer1, signer2], { feeBumpSigner });
    const signers = scheme.getSigners(STELLAR_TESTNET_CAIP2);

    expect(signers).toHaveLength(3);
    expect(signers).toContain(signer1.address);
    expect(signers).toContain(signer2.address);
    expect(signers).toContain(feeBumpSigner.address);
  });

  it("should not include feeBumpSigner when not configured", () => {
    const signer = createEd25519Signer(
      "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK",
      STELLAR_TESTNET_CAIP2,
    );

    const scheme = new ExactStellarScheme([signer]);
    const signers = scheme.getSigners(STELLAR_TESTNET_CAIP2);

    expect(signers).toHaveLength(1);
    expect(signers).toEqual([signer.address]);
  });
});
