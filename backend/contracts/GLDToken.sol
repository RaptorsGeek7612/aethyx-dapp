// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { AccessManaged } from "./access/AccessManaged.sol";

/// @notice Le versant librement transférable du wrap : 1 GLD est toujours adossé à exactement
///         1 unité (normalisée à 18 décimales) du token or ERC-3643 sous-jacent verrouillé
///         dans VaultManager. Seul VaultManager (détenteur de MINTER_ROLE) peut émettre — de
///         l'offre nouvelle ne peut naître qu'avec un dépôt correspondant, jamais seule. La
///         destruction passe par le mécanisme d'allowance ERC-20 standard (ERC20Burnable) et
///         non par un rôle : c'est l'autorisation du détenteur lui-même qui permet à
///         VaultManager de brûler lors du rachat.
contract GLDToken is ERC20, ERC20Burnable, AccessManaged {
    /// @param name_ Nom du token wrappé.
    /// @param symbol_ Symbole du token wrappé.
    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    constructor(
        string memory name_,
        string memory symbol_,
        address accessManager_
    ) ERC20(name_, symbol_) AccessManaged(accessManager_) {}

    /// @notice Émet `amount` tokens wrappés vers `to`. Appelé uniquement par VaultManager,
    ///         immédiatement après qu'il a verrouillé le collatéral ERC-3643 correspondant.
    /// @param to Destinataire des tokens émis.
    /// @param amount Quantité à émettre, en 18 décimales.
    function mint(address to, uint256 amount) external onlyRole(accessManager.MINTER_ROLE()) {
        _mint(to, amount);
    }
}
