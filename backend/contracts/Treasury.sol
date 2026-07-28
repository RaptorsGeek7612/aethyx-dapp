// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessManaged } from "./access/AccessManaged.sol";

/// @notice Passive holder of protocol fees. Deliberately knows nothing about assets, fee
///         rates or how much it's owed — VaultManager decides how much to send here on every
///         mint/redeem, and this contract only ever needs to let an authorized role withdraw
///         whatever balance it ends up holding.
contract Treasury is AccessManaged {
    using SafeERC20 for IERC20;

    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event EthWithdrawn(address indexed to, uint256 amount);

    error EthTransferFailed(address to, uint256 amount);

    constructor(address accessManager_) AccessManaged(accessManager_) {}

    receive() external payable {}

    /// @notice Sends `amount` of `token` held by the treasury to `to`.
    function withdraw(address token, address to, uint256 amount)
        external
        onlyRole(accessManager.TREASURY_MANAGER_ROLE())
    {
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    /// @notice Sends `amount` of ETH held by the treasury to `to`.
    function withdrawEth(address payable to, uint256 amount)
        external
        onlyRole(accessManager.TREASURY_MANAGER_ROLE())
    {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert EthTransferFailed(to, amount);
        emit EthWithdrawn(to, amount);
    }
}
