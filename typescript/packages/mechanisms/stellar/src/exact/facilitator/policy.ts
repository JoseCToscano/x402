import { Address, xdr } from "@stellar/stellar-sdk";
import { validateStellarAssetAddress } from "../../utils";

/** Reference facilitator ceiling. Used when the operator selects no fee profile. */
export const DEFAULT_MAX_TRANSACTION_FEE_STROOPS = 50_000;

/**
 * Warm smart-account ceiling. Above the 324,039-stroop settlement fee recorded
 * in x402#3515 (`minResourceFee` 323,939 plus the 100-stroop inclusion buffer)
 * and below a cold first-touch payment.
 */
export const DEFAULT_WARM_FEE_CAP_STROOPS = 500_000;

/**
 * Cold smart-account ceiling. Above the 5,710,000-stroop first-touch TTL
 * measurement. Opt-in, because the facilitator pays the rent.
 */
export const DEFAULT_COLD_FEE_CAP_STROOPS = 6_500_000;

/**
 * SEP-41 topics that move or authorize token balances. An allowlisted policy
 * contract cannot make these events acceptable. `transfer` is listed so a
 * policy contract cannot emit a second transfer under another name casing.
 */
export const BALANCE_MOVING_TOPICS = [
  "transfer",
  "mint",
  "burn",
  "clawback",
  "approve",
  "set_authorized",
] as const;

export const BALANCE_MOVING_TOPIC_SET: ReadonlySet<string> = new Set(BALANCE_MOVING_TOPICS);

export type StellarFeeProfileName = "warm" | "cold";

export interface StellarFeeCeilingConfig {
  feeProfile?: StellarFeeProfileName;
  maxTransactionFeeStroops?: number;
  warmCapStroops?: number;
  coldCapStroops?: number;
}

export interface ResolvedStellarFeeCeiling {
  /** Ceiling compared with `minResourceFee + inclusionFeeStroops`. */
  capStroops: number;
  /** Present only when the operator selected a profile. */
  feeProfile?: StellarFeeProfileName;
}

export type PolicyEventDecision =
  | { action: "strict" }
  | { action: "skip" }
  | { action: "reject"; reason: string; message: string };

const REJECTED_EVENT = "invalid_exact_stellar_payload_rejected_event";
const MISSING_CONTRACT_ID = "invalid_exact_stellar_payload_event_missing_contract_id";

/**
 * Requires a positive safe integer stroop amount.
 *
 * @param name - Option name used in the thrown error
 * @param value - Candidate stroop amount
 * @returns The same amount when it is a positive safe integer
 */
export function assertStroops(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer number of stroops`);
  }
  return value;
}

/**
 * Resolves the verify-time fee ceiling.
 *
 * The default stays {@link DEFAULT_MAX_TRANSACTION_FEE_STROOPS}. `warm` and
 * `cold` select measured smart-account caps. An explicit
 * `maxTransactionFeeStroops` replaces whichever cap the profile would use.
 * The settlement fee itself remains the simulation resource fee plus the
 * inclusion buffer; this function only chooses the circuit breaker.
 *
 * @param config - Operator fee options. Omitted fields keep the defaults.
 * @returns The ceiling stored on the facilitator scheme
 */
export function resolveStellarFeeCeiling(
  config: StellarFeeCeilingConfig = {},
): ResolvedStellarFeeCeiling {
  const name = config.feeProfile;
  if (name !== undefined && name !== "warm" && name !== "cold") {
    throw new Error(`Unknown fee profile "${String(name)}". Expected "warm" or "cold".`);
  }

  const warmCapStroops =
    config.warmCapStroops === undefined
      ? DEFAULT_WARM_FEE_CAP_STROOPS
      : assertStroops("warmCapStroops", config.warmCapStroops);
  const coldCapStroops =
    config.coldCapStroops === undefined
      ? DEFAULT_COLD_FEE_CAP_STROOPS
      : assertStroops("coldCapStroops", config.coldCapStroops);

  if (config.maxTransactionFeeStroops !== undefined) {
    return {
      capStroops: assertStroops("maxTransactionFeeStroops", config.maxTransactionFeeStroops),
      feeProfile: name,
    };
  }
  if (name === "warm") {
    return { capStroops: warmCapStroops, feeProfile: name };
  }
  if (name === "cold") {
    return { capStroops: coldCapStroops, feeProfile: name };
  }
  return { capStroops: DEFAULT_MAX_TRANSACTION_FEE_STROOPS };
}

/**
 * Normalizes operator policy contract ids. Empty entries and duplicates are
 * dropped. Each remaining value must be a Stellar contract address.
 *
 * @param contracts - Contract ids allowed to emit non-balance-moving events
 * @returns Deduplicated contract ids, in first-seen order
 */
export function normalizePolicyContracts(contracts: readonly string[] | undefined): string[] {
  if (contracts === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const contract of contracts) {
    const value = contract.trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    if (!validateStellarAssetAddress(value)) {
      throw new Error(`Policy contract id is not a Stellar contract address: ${value}`);
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

/**
 * Normalizes the optional topic allowlist. An empty result means any
 * non-balance-moving topic from an allowlisted contract is accepted.
 * Balance-moving topics are rejected here so they cannot be opted in.
 *
 * @param topics - First-topic symbols the operator expects policy contracts to emit
 * @returns Deduplicated topics, in first-seen order
 */
export function normalizePolicyEventTopics(topics: readonly string[] | undefined): string[] {
  if (topics === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const topic of topics) {
    const value = topic.trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    if (BALANCE_MOVING_TOPIC_SET.has(value.toLowerCase())) {
      throw new Error(`Policy event topic "${value}" is balance-moving and cannot be allowlisted`);
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

/**
 * Decides whether one contract event may skip the strict transfer scan.
 *
 * `transfer` falls through to that scan. Every other balance-moving topic is
 * rejected, including when the emitter is allowlisted. Other topics are
 * skipped only for `policyContracts`, and only when `policyEventTopics` is
 * empty or contains the topic. Events from the payment asset are never skipped.
 *
 * @param event - Contract event from a simulation diagnostic
 * @param expectedAsset - Payment token contract address
 * @param policyContracts - Allowlisted policy contract ids
 * @param policyEventTopics - Topic allowlist; empty accepts any non-balance-moving topic
 * @returns `strict` to keep the event, `skip` to drop it, or a rejection
 */
export function gatePolicyContractEvent(
  event: xdr.ContractEvent,
  expectedAsset: string,
  policyContracts: ReadonlySet<string>,
  policyEventTopics: ReadonlySet<string>,
): PolicyEventDecision {
  const contractIdHash = event.contractId();
  if (!contractIdHash) {
    return {
      action: "reject",
      reason: MISSING_CONTRACT_ID,
      message: "rejected event with no contract id",
    };
  }

  const eventContractAddress = Address.fromScAddress(
    xdr.ScAddress.scAddressTypeContract(contractIdHash),
  ).toString();
  const topics = event.body().v0().topics();
  const first = topics[0];
  const symbol = first?.switch().name === "scvSymbol" ? first.sym().toString() : null;
  const topicLabel = symbol ?? "(no topic)";

  if (symbol === "transfer") {
    return { action: "strict" };
  }

  if (symbol !== null && BALANCE_MOVING_TOPIC_SET.has(symbol.toLowerCase())) {
    return reject(topicLabel, eventContractAddress, "balance_moving_topic");
  }
  if (eventContractAddress === expectedAsset) {
    return reject(topicLabel, eventContractAddress, "unexpected_asset_event");
  }
  if (!policyContracts.has(eventContractAddress)) {
    return reject(topicLabel, eventContractAddress, "emitter_not_allowlisted");
  }
  if (policyEventTopics.size > 0 && (symbol === null || !policyEventTopics.has(symbol))) {
    return reject(topicLabel, eventContractAddress, "topic_not_allowlisted");
  }
  return { action: "skip" };
}

/**
 * Builds a rejected policy-event decision.
 *
 * @param topic - First topic symbol, or a placeholder when the topic is not a symbol
 * @param contractId - Emitting contract address
 * @param reason - Stable reason token included in the message
 * @returns A reject decision for `validateSimulationEvents`
 */
function reject(topic: string, contractId: string, reason: string): PolicyEventDecision {
  return {
    action: "reject",
    reason: REJECTED_EVENT,
    message: `rejected ${topic} from ${contractId} (${reason})`,
  };
}
