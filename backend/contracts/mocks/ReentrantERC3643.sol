// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IVaultManagerLike {
    function deposit(bytes32 assetId, uint256 amount) external returns (uint256);
    function redeem(bytes32 assetId, uint256 wrappedAmount) external returns (uint256);
}

/// @notice Malicious stand-in for an ERC-3643 underlying, for reentrancy tests only. Mirrors
///         MockERC3643's compliance surface, but its transferFrom hook can be armed to call
///         straight back into VaultManager mid-transfer — exactly the callback path a
///         malicious or merely buggy real-world token could exploit if VaultManager.deposit/
///         redeem weren't guarded by ReentrancyGuard. If the guard is doing its job, the
///         reentrant call reverts and unwinds the whole outer transaction with it.
contract ReentrantERC3643 is ERC20 {
    address public vaultManager;
    bytes32 public targetAssetId;
    bool public reenterOnDeposit;
    bool public reenterOnWithdraw;

    mapping(address => bool) public verified;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setVerified(address account, bool verifiedStatus) external {
        verified[account] = verifiedStatus;
    }

    function isVerified(address userAddress) external view returns (bool) {
        return verified[userAddress];
    }

    function canTransfer(address, address, uint256) external pure returns (bool) {
        return true;
    }

    /// @notice Arms a reentrant call into `vaultManager_.deposit(assetId_, amount)` the next
    ///         time this token's transferFrom is invoked — i.e. right as VaultManager.deposit
    ///         pulls the underlying into the adapter's custody, before it mints anything.
    function armDepositReentrancy(address vaultManager_, bytes32 assetId_) external {
        vaultManager = vaultManager_;
        targetAssetId = assetId_;
        reenterOnDeposit = true;
    }

    /// @notice Arms a reentrant call into `vaultManager_.redeem(assetId_, amount)` the next
    ///         time this token's transfer is invoked — i.e. right as VaultManager.redeem
    ///         releases the underlying back out of the adapter, after burning the wrapped side.
    function armWithdrawReentrancy(address vaultManager_, bytes32 assetId_) external {
        vaultManager = vaultManager_;
        targetAssetId = assetId_;
        reenterOnWithdraw = true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (reenterOnDeposit) {
            reenterOnDeposit = false;
            IVaultManagerLike(vaultManager).deposit(targetAssetId, amount);
        }
        return super.transferFrom(from, to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (reenterOnWithdraw) {
            reenterOnWithdraw = false;
            IVaultManagerLike(vaultManager).redeem(targetAssetId, amount);
        }
        return super.transfer(to, amount);
    }
}
