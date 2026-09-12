// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { AccessManaged } from "./access/AccessManaged.sol";

/// @notice Stablecoin de dette émis par CDPManager contre du collatéral surdimensionné. 1 unité
///         vaut nominalement 1 unité de l'étalon dans lequel les sources de prix des collatéraux
///         enregistrés sont libellées (voir la mise en garde dans CDPManager.addCollateralType) ;
///         cette parité n'est pas imposée on-chain ici, elle repose entièrement sur le ratio de
///         collatéralisation exigé à l'émission et sur la liquidation des positions qui en
///         sortent. Seul CDPManager (détenteur de DEBT_MINTER_ROLE) peut émettre — de l'offre
///         nouvelle ne peut naître que contre une dette correspondante ouverte dans une
///         position. La destruction passe par le mécanisme d'allowance ERC-20 standard
///         (ERC20Burnable) et non par un rôle : c'est l'autorisation du détenteur ou du
///         liquidateur qui permet à CDPManager de brûler lors d'un remboursement ou d'une
///         liquidation.
contract StableToken is ERC20, ERC20Burnable, AccessManaged {
    /// @notice Rôle habilité à émettre ce stablecoin, détenu exclusivement par CDPManager.
    ///         Calculé localement plutôt que lu via `accessManager.DEBT_MINTER_ROLE()` — même
    ///         raisonnement que `CDPManager.RISK_MANAGER_ROLE` : un `AccessManager` déjà déployé
    ///         avant l'ajout de ce rôle à son code source n'expose pas ce getter, alors que
    ///         `hasRole` fonctionne pour n'importe quelle valeur `bytes32`.
    bytes32 public constant DEBT_MINTER_ROLE = keccak256("DEBT_MINTER_ROLE");

    /// @param name_ Nom du stablecoin.
    /// @param symbol_ Symbole du stablecoin.
    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    constructor(
        string memory name_,
        string memory symbol_,
        address accessManager_
    ) ERC20(name_, symbol_) AccessManaged(accessManager_) {}

    /// @notice Émet `amount` unités du stablecoin vers `to`. Appelé uniquement par CDPManager,
    ///         immédiatement après qu'il a vérifié que la position reste au-dessus de son ratio
    ///         de collatéralisation minimal.
    /// @param to Destinataire des tokens émis.
    /// @param amount Quantité à émettre, en 18 décimales.
    function mint(address to, uint256 amount) external onlyRole(DEBT_MINTER_ROLE) {
        _mint(to, amount);
    }
}
