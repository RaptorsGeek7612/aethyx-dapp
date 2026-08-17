/** Mirrors AssetAdapter.sol's `_toCanonical`: normalizes a raw token amount to 18 decimals. */
export function toCanonical18(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount;
  if (decimals < 18) return amount * 10n ** BigInt(18 - decimals);
  return amount / 10n ** BigInt(decimals - 18);
}
