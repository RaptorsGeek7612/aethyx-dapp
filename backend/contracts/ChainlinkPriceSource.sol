// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/**
 * @title ChainlinkPriceSource
 * @notice Source de prix externe adossée à un agrégateur Chainlink.
 *
 * @dev Cette source est délibérément défensive : elle traite l'agrégateur comme une
 *      dépendance faillible et non comme une vérité. Toute anomalie fait revert, ce qui
 *      permet à `OracleManager` d'exclure la source de la médiane plutôt que d'agréger
 *      une valeur douteuse.
 *
 *      L'adresse de l'agrégateur n'est PAS codée en dur : récupère-la sur
 *      https://docs.chain.link/data-feeds/price-feeds/addresses (section Sepolia testnet)
 *      et passe-la au constructeur. Si XAU/USD n'y est pas listé, le feed BTC/USD Sepolia
 *      0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43 est documenté officiellement et fait un
 *      substitut honnête pour la démo — à condition de le dire au jury.
 *
 *      `assetId` est ignoré : une ChainlinkPriceSource enveloppe un seul feed, déployée une
 *      fois par actif — c'est la forme commune à toute IPriceSource, celle qui permet à
 *      OracleManager de les agréger indifféremment les unes des autres.
 */
contract ChainlinkPriceSource is IPriceSource {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAggregator();
    error NonPositiveAnswer(int256 answer);
    error IncompleteRound(uint80 roundId, uint80 answeredInRound);
    error UnsetTimestamp();
    error UnsupportedDecimals(uint8 feedDecimals);

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Agrégateur Chainlink interrogé (proxy, pas l'implémentation sous-jacente).
    AggregatorV3Interface public immutable aggregator;

    /// @notice Décimales du feed, lues une fois au déploiement.
    uint8 public immutable feedDecimals;

    /// @notice Base de sortie commune à toutes les sources du protocole.
    uint8 public constant TARGET_DECIMALS = 18;

    /// @notice Libellé lisible, ex. "Chainlink XAU/USD (Sepolia)".
    string public description;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address aggregator_, string memory description_) {
        if (aggregator_ == address(0)) revert ZeroAggregator();

        aggregator = AggregatorV3Interface(aggregator_);

        uint8 decimals_ = AggregatorV3Interface(aggregator_).decimals();
        if (decimals_ > TARGET_DECIMALS) revert UnsupportedDecimals(decimals_);

        feedDecimals = decimals_;
        description = description_;
    }

    /*//////////////////////////////////////////////////////////////
                                 READ
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Retourne le dernier prix publié, normalisé à 18 décimales.
     * @dev Revert dans tous les cas suspects — c'est le comportement attendu par
     *      `OracleManager`, qui exclut alors la source de l'agrégation.
     * @return price     Prix en base 18.
     * @return updatedAt Horodatage de la dernière publication, utilisé par le filtre de péremption.
     */
    function latestPrice(bytes32) external view returns (uint256 price, uint256 updatedAt) {
        (uint80 roundId, int256 answer,, uint256 updatedAt_, uint80 answeredInRound) = aggregator.latestRoundData();

        // 1. Un prix nul ou négatif n'a aucun sens pour un actif : la donnée est corrompue.
        if (answer <= 0) revert NonPositiveAnswer(answer);

        // 2. Round jamais finalisé : l'horodatage n'a pas été écrit.
        if (updatedAt_ == 0) revert UnsetTimestamp();

        // 3. Réponse issue d'un round antérieur : donnée reportée, potentiellement obsolète.
        if (answeredInRound < roundId) revert IncompleteRound(roundId, answeredInRound);

        price = _scaleTo18(uint256(answer));
        updatedAt = updatedAt_;
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Chainlink publie généralement en 8 décimales ; le protocole raisonne en 18.
    function _scaleTo18(uint256 raw) internal view returns (uint256) {
        if (feedDecimals == TARGET_DECIMALS) return raw;
        return raw * (10 ** uint256(TARGET_DECIMALS - feedDecimals));
    }
}
