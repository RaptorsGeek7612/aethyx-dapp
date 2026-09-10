/** The protocol's canonical precision — AssetAdapter normalizes every underlying to 18 decimals,
 *  so adapter-reported figures (lock-up tranches, for one) are always in these units regardless of
 *  what the underlying token itself uses. */
export const CANONICAL_DECIMALS = 18;

/** Mirrors AssetAdapter.sol's `_toCanonical`: normalizes a raw token amount to 18 decimals. */
export function toCanonical18(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount;
  if (decimals < 18) return amount * 10n ** BigInt(18 - decimals);
  return amount / 10n ** BigInt(decimals - 18);
}
