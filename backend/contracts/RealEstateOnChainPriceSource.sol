// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IPriceSource } from "./interfaces/IPriceSource.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Prix d'un marché immobilier fractionné, calculé en direct à chaque lecture plutôt que
///         poussé manuellement par un opérateur.
/// @dev Contrairement à l'or et l'argent, un marché immobilier n'a pas de prix de marché
///      indépendant : sa valeur par jeton n'est que son estimation statique divisée par le nombre
///      de jetons wrappés actuellement en circulation, un ratio qui bouge à chaque dépôt et chaque
///      rachat. `backend/scripts/update-real-estate-price.ts` maintenait ce ratio à jour en le
///      recalculant et en le poussant manuellement dans un `ManualPriceSource` — une charge
///      opérationnelle récurrente, oubliable, dont l'oubli rend le prix silencieusement faux avant
///      même qu'`OracleManager` ne le rejette pour péremption. Ce contrat supprime le problème
///      plutôt que de rappeler qu'il faut le traiter : `totalSupply()` est lu à chaque appel, donc
///      le prix qui en découle est **toujours** exact, et `updatedAt` vaut toujours
///      `block.timestamp`, donc il n'est **jamais** périmé au sens d'`OracleManager`.
///
///      `OracleManager.config.minSources` s'applique à tous les actifs sans distinction ; il faut
///      donc au moins deux sources fraîches enregistrées pour cet actif précis, comme pour l'or et
///      l'argent. Deux instances de ce contrat, déployées côte à côte pour le même marché,
///      suffisent : elles calculent la même formule à partir du même état on-chain et sont donc
///      toujours d'accord, mais existent en tant que contrats distincts pour satisfaire ce quorum
///      mécaniquement, sans reposer sur la diligence d'un opérateur.
contract RealEstateOnChainPriceSource is IPriceSource {
    /// @notice Token wrappé dont l'offre en circulation détermine le prix par jeton.
    IERC20 public immutable wrappedToken;
    /// @notice Estimation statique du marché entier, en 18 décimales d'euros.
    uint256 public immutable appraisalValueEur18;

    /// @notice L'offre en circulation est nulle : aucun prix par jeton n'a de sens.
    error ZeroSupply();

    /// @param wrappedToken_ Token wrappé dont `totalSupply()` divise l'estimation.
    /// @param appraisalValueEur18_ Estimation statique du marché entier, en 18 décimales.
    constructor(address wrappedToken_, uint256 appraisalValueEur18_) {
        wrappedToken = IERC20(wrappedToken_);
        appraisalValueEur18 = appraisalValueEur18_;
    }

    /// @inheritdoc IPriceSource
    /// @dev `assetId` n'est pas utilisé : une instance de ce contrat est dédiée à un seul marché,
    ///      fixé au déploiement via `wrappedToken`, plutôt que de servir plusieurs actifs comme le
    ///      permettrait `ManualPriceSource`. `OracleManager` traite un revert exactement comme une
    ///      source périmée ou nulle — voir sa boucle d'agrégation — donc une offre nulle exclut
    ///      proprement cette source de la médiane plutôt que de faire échouer tout l'appel.
    function latestPrice(bytes32) external view returns (uint256 price, uint256 updatedAt) {
        uint256 supply = wrappedToken.totalSupply();
        if (supply == 0) revert ZeroSupply();
        price = (appraisalValueEur18 * 1e18) / supply;
        updatedAt = block.timestamp;
    }
}
