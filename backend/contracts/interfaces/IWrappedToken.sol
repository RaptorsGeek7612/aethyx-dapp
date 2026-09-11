// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Surface que tout token wrappé (GLDToken, puis SLDToken, RLDToken...) doit exposer,
///         en plus de l'ERC-20 standard, pour que VaultManager puisse émettre au dépôt et
///         brûler au rachat. GLDToken la satisfait sans la déclarer explicitement : `mint`
///         plus le `burnFrom` hérité d'ERC20Burnable suffisent.
interface IWrappedToken is IERC20 {
    /// @notice Émet `amount` tokens wrappés vers `to`.
    /// @param to Destinataire des tokens émis.
    /// @param amount Quantité à émettre.
    function mint(address to, uint256 amount) external;

    /// @notice Brûle `amount` tokens détenus par `account`, dans la limite de son allowance.
    /// @param account Détenteur dont les tokens sont brûlés.
    /// @param amount Quantité à brûler.
    function burnFrom(address account, uint256 amount) external;
}
