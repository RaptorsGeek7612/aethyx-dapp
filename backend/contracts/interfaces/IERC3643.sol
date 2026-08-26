// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal interface for interacting with an ERC-3643 (T-REX) permissioned token.
/// @dev Covers only the ERC-20 surface plus the compliance checks that AssetAdapter
///      implementations need to safely move tokens in and out of the vault. Issuer-only
///      operations (mint, forcedTransfer, freeze, agent management) are intentionally
///      excluded: this codebase only ever acts as a holder of the token, never as its issuer.
interface IERC3643 {
    /// @notice True if `userAddress` holds a verified on-chain identity recognized by this
    ///         token's Identity Registry. A prerequisite to holding or receiving the token.
    /// @dev The AssetAdapter contract's own address must satisfy this check — arranged
    ///      out-of-band with the token issuer — before any deposit can ever succeed.

    function isVerified(address userAddress) external view returns (bool);

    function decimals() external view returns (uint8);

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    /// @notice Pre-flight check: would a transfer of `amount` from `from` to `to` currently
    ///         pass this token's identity and compliance rules?
    /// @dev Adapters must call this before attempting transferFrom, since a failed compliance
    ///      check reverts with no useful reason string on most T-REX deployments.
    function canTransfer(address from, address to, uint256 amount) external view returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);
}
