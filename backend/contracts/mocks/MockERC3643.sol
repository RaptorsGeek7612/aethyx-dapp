// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal stand-in for a real T-REX ERC-3643 token, for tests only. Tracks a
///         verified-identity whitelist and a global compliance switch so tests can exercise
///         AssetAdapter's pre-flight checks without pulling in the full T-REX stack.
/// @dev Compliance is enforced both in `canTransfer` (the pre-flight view AssetAdapter calls)
///      and inside `_update` (the actual transfer), mirroring how a real T-REX token would
///      reject a non-compliant transfer even if a caller skipped the pre-flight check.
contract MockERC3643 is ERC20 {
    uint8 private immutable _customDecimals;
    mapping(address => bool) public verified;
    bool public complianceOk = true;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _customDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setVerified(address account, bool verifiedStatus) external {
        verified[account] = verifiedStatus;
    }

    function setComplianceOk(bool ok) external {
        complianceOk = ok;
    }

    function isVerified(address userAddress) external view returns (bool) {
        return verified[userAddress];
    }

    function canTransfer(address from, address to, uint256) external view returns (bool) {
        return complianceOk && verified[from] && verified[to];
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            require(complianceOk && verified[from] && verified[to], "MockERC3643: compliance check failed");
        }
        super._update(from, to, value);
    }
}
