// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { AccessManaged } from "./access/AccessManaged.sol";
import { AssetAdapter } from "./AssetAdapter.sol";
import { IWrappedToken } from "./interfaces/IWrappedToken.sol";

/// @notice Core orchestrator of the wrap: locks an ERC-3643 asset via its AssetAdapter and
///         mints the matching wrapped ERC-20, or burns the wrapped ERC-20 and releases the
///         underlying back. Central invariant enforced for every registered asset: total
///         wrapped supply always equals the total value locked in its adapter, in canonical
///         18-decimal terms — including whatever Treasury holds as fee revenue. Nothing is
///         ever minted without a matching deposit, nothing is ever burned without releasing
///         the matching collateral.
contract VaultManager is AccessManaged, Pausable, ReentrancyGuard {
    struct AssetConfig {
        AssetAdapter adapter;
        IWrappedToken wrappedToken;
        uint16 depositFeeBps;
        uint16 redeemFeeBps;
        bool active;
    }

    uint256 private constant BPS_DENOMINATOR = 10_000;

    address public immutable treasury;

    mapping(bytes32 assetId => AssetConfig config) public assets;

    event AssetRegistered(bytes32 indexed assetId, address indexed adapter, address indexed wrappedToken);
    event AssetActiveSet(bytes32 indexed assetId, bool active);
    event AssetFeesSet(bytes32 indexed assetId, uint16 depositFeeBps, uint16 redeemFeeBps);
    event Deposited(
        bytes32 indexed assetId, address indexed user, uint256 underlyingAmount, uint256 mintedAmount, uint256 feeAmount
    );
    event Redeemed(
        bytes32 indexed assetId, address indexed user, uint256 wrappedAmount, uint256 underlyingAmount, uint256 feeAmount
    );

    error AssetNotActive(bytes32 assetId);
    error AssetAlreadyRegistered(bytes32 assetId);
    error FeeTooHigh(uint16 feeBps);

    constructor(address accessManager_, address treasury_) AccessManaged(accessManager_) {
        treasury = treasury_;
    }

    /// @notice Registers a new adapter/wrapped-token pair under `assetId`. Only ever called by
    ///         WrappedTokenFactory, right after it deploys both contracts together.
    function registerAsset(
        bytes32 assetId,
        address adapter,
        address wrappedToken,
        uint16 depositFeeBps,
        uint16 redeemFeeBps
    ) external onlyRole(accessManager.FACTORY_ROLE()) {
        if (address(assets[assetId].adapter) != address(0)) revert AssetAlreadyRegistered(assetId);
        _validateFees(depositFeeBps, redeemFeeBps);

        assets[assetId] = AssetConfig({
            adapter: AssetAdapter(adapter),
            wrappedToken: IWrappedToken(wrappedToken),
            depositFeeBps: depositFeeBps,
            redeemFeeBps: redeemFeeBps,
            active: true
        });
        emit AssetRegistered(assetId, adapter, wrappedToken);
    }

    function setAssetActive(bytes32 assetId, bool active) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) {
        assets[assetId].active = active;
        emit AssetActiveSet(assetId, active);
    }

    function setAssetFees(bytes32 assetId, uint16 depositFeeBps, uint16 redeemFeeBps)
        external
        onlyRole(accessManager.ASSET_MANAGER_ROLE())
    {
        _validateFees(depositFeeBps, redeemFeeBps);
        AssetConfig storage config = assets[assetId];
        config.depositFeeBps = depositFeeBps;
        config.redeemFeeBps = redeemFeeBps;
        emit AssetFeesSet(assetId, depositFeeBps, redeemFeeBps);
    }

    function pause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _pause();
    }

    function unpause() external onlyRole(accessManager.PAUSER_ROLE()) {
        _unpause();
    }

    /// @notice Deposits `amount` (underlying decimals) of the ERC-3643 asset identified by
    ///         `assetId`, minting the equivalent wrapped ERC-20 (minus the deposit fee) to
    ///         the caller.
    function deposit(bytes32 assetId, uint256 amount) external whenNotPaused nonReentrant returns (uint256 mintedAmount) {
        return _deposit(assetId, amount, msg.sender);
    }

    /// @notice Same as deposit, but pulls from and mints to `depositor` instead of msg.sender.
    /// @dev Restricted to ROUTER_ROLE, held only by InvestOrGateway. This is what lets the
    ///      Gateway forward a deposit on behalf of its own caller without ever custodying the
    ///      ERC-3643 token itself: `depositor` must still have approved the asset's adapter
    ///      directly, exactly as for a direct call to `deposit`. A router is fully trusted to
    ///      only ever pass through its own immediate msg.sender here, never an arbitrary
    ///      third-party address — the same trust level already placed in MINTER_ROLE/
    ///      FACTORY_ROLE holders.
    function depositFor(bytes32 assetId, uint256 amount, address depositor)
        external
        whenNotPaused
        nonReentrant
        onlyRole(accessManager.ROUTER_ROLE())
        returns (uint256 mintedAmount)
    {
        return _deposit(assetId, amount, depositor);
    }

    /// @notice Burns `wrappedAmount` of the wrapped ERC-20 for `assetId` from the caller and
    ///         releases the equivalent underlying ERC-3643 (minus the redeem fee) to them.
    ///         Requires the caller to have approved this contract for at least `wrappedAmount`.
    function redeem(bytes32 assetId, uint256 wrappedAmount)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 underlyingAmount)
    {
        return _redeem(assetId, wrappedAmount, msg.sender);
    }

    /// @notice Same as redeem, but burns from and releases to `redeemer` instead of
    ///         msg.sender. Restricted to ROUTER_ROLE — see depositFor's natspec.
    function redeemFor(bytes32 assetId, uint256 wrappedAmount, address redeemer)
        external
        whenNotPaused
        nonReentrant
        onlyRole(accessManager.ROUTER_ROLE())
        returns (uint256 underlyingAmount)
    {
        return _redeem(assetId, wrappedAmount, redeemer);
    }

    function _deposit(bytes32 assetId, uint256 amount, address depositor) private returns (uint256 mintedAmount) {
        AssetConfig storage config = assets[assetId];
        if (!config.active) revert AssetNotActive(assetId);

        uint256 normalizedAmount = config.adapter.deposit(depositor, amount);
        uint256 feeAmount = (normalizedAmount * config.depositFeeBps) / BPS_DENOMINATOR;
        mintedAmount = normalizedAmount - feeAmount;

        config.wrappedToken.mint(depositor, mintedAmount);
        if (feeAmount > 0) config.wrappedToken.mint(treasury, feeAmount);

        emit Deposited(assetId, depositor, amount, mintedAmount, feeAmount);
    }

    function _redeem(bytes32 assetId, uint256 wrappedAmount, address redeemer) private returns (uint256 underlyingAmount) {
        AssetConfig storage config = assets[assetId];
        if (!config.active) revert AssetNotActive(assetId);

        uint256 feeAmount = (wrappedAmount * config.redeemFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = wrappedAmount - feeAmount;

        if (feeAmount > 0) config.wrappedToken.transferFrom(redeemer, treasury, feeAmount);
        config.wrappedToken.burnFrom(redeemer, netAmount);

        underlyingAmount = config.adapter.withdraw(redeemer, netAmount);

        emit Redeemed(assetId, redeemer, wrappedAmount, underlyingAmount, feeAmount);
    }

    function _validateFees(uint16 depositFeeBps, uint16 redeemFeeBps) private pure {
        if (depositFeeBps > BPS_DENOMINATOR) revert FeeTooHigh(depositFeeBps);
        if (redeemFeeBps > BPS_DENOMINATOR) revert FeeTooHigh(redeemFeeBps);
    }
}
