// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Shape every wrapped token (GLDToken, and future SLDToken, RLDToken...) must expose
///         for VaultManager to mint on deposit and burn on redemption, on top of standard
///         ERC-20. GLDToken satisfies this without explicitly declaring it: mint + the
///         inherited ERC20Burnable.burnFrom are enough.
interface IWrappedToken is IERC20 {
    function mint(address to, uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}
