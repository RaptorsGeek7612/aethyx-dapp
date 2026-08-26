// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { AccessManaged } from "./access/AccessManaged.sol";

/// @notice The freely-transferable ERC-20 side of the wrap: 1 GLD is always backed by exactly
///         1 unit (18-decimals-normalized) of the underlying ERC-3643 gold token locked in
///         VaultManager. Only VaultManager (holder of MINTER_ROLE) can mint — new supply can
///         only ever be created alongside a matching deposit, never on its own. Burning goes
///         through the standard ERC-20 allowance mechanism (ERC20Burnable), not a role: the
///         token holder's own approval is what authorizes VaultManager to burn on redemption.
contract GLDToken is ERC20, ERC20Burnable, AccessManaged {
    constructor(
        string memory name_,
        string memory symbol_,
        address accessManager_
    ) ERC20(name_, symbol_) AccessManaged(accessManager_) {}

    /// @notice Mints `amount` wrapped tokens to `to`. Only ever called by VaultManager,
    ///         immediately after it has locked the matching ERC-3643 collateral.
    function mint(address to, uint256 amount) external onlyRole(accessManager.MINTER_ROLE()) {
        _mint(to, amount);
    }
}
