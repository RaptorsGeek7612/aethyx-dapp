// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AssetAdapter } from "./AssetAdapter.sol";

/// @notice Concrete AssetAdapter for a fractionalized real-estate ERC-3643 token. Adds a
///         minimum holding period before redemption: real-estate settlement (title transfer,
///         notary processing...) takes real time, unlike a purely digital asset that can be
///         wrapped and unwrapped in the same block.
/// @dev The lock-up is tracked per `from`/`to` address. This is safe for per-depositor state
///      even when routed through InvestOrGateway: VaultManager's depositFor/redeemFor always
///      forward the Gateway's own caller, never the Gateway's address, so this adapter always
///      sees the real end user — see VaultManager.sol and InvestOrGateway.sol.
contract RealEstateAdapter is AssetAdapter {
    /// @notice One deposit's own lock. Each deposit matures on its own schedule; a later deposit
    ///         never postpones an earlier one (the previous design stored a single `lockedUntil`
    ///         per address and overwrote it on every deposit, so topping up a nearly-matured
    ///         position re-locked all of it for a further full period).
    struct Lock {
        uint256 amount;
        uint256 unlockAt;
    }

    uint256 public immutable lockupPeriod;

    /// @dev Append-only per depositor. `lockupPeriod` is immutable, so `unlockAt` is
    ///      non-decreasing along this array and maturity can be swept from the front and stopped
    ///      at the first entry that is still locked — no scan of the whole history.
    mapping(address depositor => Lock[]) private _locks;
    /// @dev Index of the first not-yet-matured entry in `_locks[depositor]`; everything before it
    ///      has already been swept into `maturedAmount` and is never revisited.
    mapping(address depositor => uint256 cursor) private _cursor;

    /// @notice Deposited amount (canonical 18 decimals) whose own lock-up has not elapsed yet, as
    ///         of the last sweep. Read `lockedAmountOf` instead for a live figure.
    mapping(address depositor => uint256) public lockedAmount;
    /// @notice Deposited amount (canonical 18 decimals) whose lock-up has elapsed and that has
    ///         not been redeemed yet. Read `maturedAmountOf` instead for a live figure.
    mapping(address depositor => uint256) public maturedAmount;

    /// @param requested The normalized amount the redemption asked this adapter to release.
    /// @param available How much of `account`'s deposits have matured and are still unredeemed.
    /// @param nextUnlockAt When the next tranche matures, so a caller can say how long to wait.
    error StillLocked(address account, uint256 requested, uint256 available, uint256 nextUnlockAt);

    constructor(
        address underlying_,
        address vaultManager_,
        bytes32 assetId_,
        uint256 lockupPeriod_
    ) AssetAdapter(underlying_, vaultManager_, assetId_) {
        lockupPeriod = lockupPeriod_;
    }

    function deposit(address from, uint256 amount) public override onlyVaultManager returns (uint256 normalizedAmount) {
        normalizedAmount = super.deposit(from, amount);
        _locks[from].push(Lock({ amount: normalizedAmount, unlockAt: block.timestamp + lockupPeriod }));
        lockedAmount[from] += normalizedAmount;
    }

    function withdraw(address to, uint256 normalizedAmount) public override onlyVaultManager returns (uint256 amount) {
        _sweepMatured(to);

        uint256 matured = maturedAmount[to];
        // A holder with nothing locked is unrestricted: wrapped tokens are freely transferable, so
        // whoever acquired them on the secondary market never deposited here and has no lock of
        // their own to wait out. The lock-up only ever holds back a depositor's own unmatured
        // tranches — never someone else's redemption.
        if (lockedAmount[to] > 0 && normalizedAmount > matured) {
            revert StillLocked(to, normalizedAmount, matured, nextUnlockAt(to));
        }

        // Saturating: a redemption may legitimately exceed the credit (tokens bought on the
        // secondary market on top of one's own matured deposits), and the excess is not tracked.
        maturedAmount[to] = matured > normalizedAmount ? matured - normalizedAmount : 0;

        return super.withdraw(to, normalizedAmount);
    }

    /// @notice `depositor`'s deposits that are still within their own lock-up, right now.
    function lockedAmountOf(address depositor) external view returns (uint256 locked) {
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt > block.timestamp) locked += locks[i].amount;
        }
    }

    /// @notice `depositor`'s deposits that have cleared their lock-up and are redeemable now.
    function maturedAmountOf(address depositor) external view returns (uint256 matured) {
        matured = maturedAmount[depositor];
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt <= block.timestamp) matured += locks[i].amount;
        }
    }

    /// @notice When `depositor`'s next tranche matures, or 0 if nothing of theirs is locked.
    function nextUnlockAt(address depositor) public view returns (uint256) {
        Lock[] storage locks = _locks[depositor];
        for (uint256 i = _cursor[depositor]; i < locks.length; ++i) {
            if (locks[i].unlockAt > block.timestamp) return locks[i].unlockAt;
        }
        return 0;
    }

    /// @notice `depositor`'s full remaining schedule, for a UI that shows what frees up when.
    ///         Entries already redeemed against `maturedAmount` are not removed from this list.
    function lockSchedule(address depositor) external view returns (Lock[] memory schedule) {
        Lock[] storage locks = _locks[depositor];
        uint256 start = _cursor[depositor];
        schedule = new Lock[](locks.length - start);
        for (uint256 i = start; i < locks.length; ++i) {
            schedule[i - start] = locks[i];
        }
    }

    /// @dev Moves every tranche whose lock-up has elapsed out of `lockedAmount` and into
    ///      `maturedAmount`, advancing the cursor past it. Stops at the first still-locked entry:
    ///      `unlockAt` is non-decreasing, so nothing later can have matured earlier.
    function _sweepMatured(address depositor) private {
        Lock[] storage locks = _locks[depositor];
        uint256 i = _cursor[depositor];
        uint256 swept;

        while (i < locks.length && locks[i].unlockAt <= block.timestamp) {
            swept += locks[i].amount;
            unchecked {
                ++i;
            }
        }

        if (swept > 0) {
            _cursor[depositor] = i;
            lockedAmount[depositor] -= swept;
            maturedAmount[depositor] += swept;
        }
    }
}
