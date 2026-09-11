// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessManaged } from "./access/AccessManaged.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/// @notice Agrège, pour chaque actif, les flux de prix de plusieurs sources indépendantes
///         (Chainlink, Pyth, une source poussée manuellement...) et expose un prix médian
///         unique, résistant à la manipulation. Aucune source ne peut déplacer à elle seule le
///         prix publié : une source périmée ou très divergente est exclue plutôt que crue
///         aveuglément.
contract OracleManager is AccessManaged {
    /// @notice Paramètres d'agrégation, communs à tous les actifs.
    /// @param maxStaleness Ancienneté maximale, en secondes, au-delà de laquelle le prix d'une
    ///        source est ignoré.
    /// @param maxDeviationBps Écart maximal toléré entre le plus bas et le plus haut des prix
    ///        retenus, en points de base.
    /// @param minSources Nombre minimal de sources fraîches exigé pour agréger.
    struct Config {
        uint256 maxStaleness;
        uint256 maxDeviationBps;
        uint256 minSources;
    }

    /// @dev Dénominateur des points de base : 10 000 bps = 100 %.
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @notice Paramètres d'agrégation en vigueur.
    Config public config;

    /// @dev Sources enregistrées pour chaque actif. Sans énumération publique : les
    ///      consommateurs reconstituent la liste depuis les événements PriceSourceAdded et
    ///      PriceSourceRemoved.
    mapping(bytes32 assetId => address[] sources) private _sources;

    /// @notice Émis lorsqu'une source est ajoutée à un actif.
    /// @param assetId Actif concerné.
    /// @param source Source ajoutée.
    event PriceSourceAdded(bytes32 indexed assetId, address indexed source);
    /// @notice Émis lorsqu'une source est retirée d'un actif.
    /// @param assetId Actif concerné.
    /// @param source Source retirée.
    event PriceSourceRemoved(bytes32 indexed assetId, address indexed source);
    /// @notice Émis lorsque les paramètres d'agrégation changent.
    /// @param maxStaleness Nouvelle ancienneté maximale, en secondes.
    /// @param maxDeviationBps Nouvel écart maximal toléré, en points de base.
    /// @param minSources Nouveau nombre minimal de sources fraîches.
    event ConfigUpdated(uint256 maxStaleness, uint256 maxDeviationBps, uint256 minSources);

    /// @notice Trop peu de sources fraîches pour produire un prix digne de confiance.
    /// @param assetId Actif concerné.
    /// @param found Nombre de sources fraîches trouvées.
    /// @param required Nombre minimal exigé.
    error InsufficientFreshSources(bytes32 assetId, uint256 found, uint256 required);
    /// @notice Les sources fraîches divergent trop pour que leur médiane ait un sens.
    /// @param assetId Actif concerné.
    /// @param minPrice Plus bas prix retenu.
    /// @param maxPrice Plus haut prix retenu.
    error PriceDeviationTooHigh(bytes32 assetId, uint256 minPrice, uint256 maxPrice);
    /// @notice La source à retirer n'est pas enregistrée pour cet actif.
    /// @param assetId Actif concerné.
    /// @param source Source introuvable.
    error SourceNotRegistered(bytes32 assetId, address source);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    /// @param maxStaleness_ Ancienneté maximale acceptée, en secondes.
    /// @param maxDeviationBps_ Écart maximal toléré, en points de base.
    /// @param minSources_ Nombre minimal de sources fraîches exigé.
    constructor(
        address accessManager_,
        uint256 maxStaleness_,
        uint256 maxDeviationBps_,
        uint256 minSources_
    ) AccessManaged(accessManager_) {
        config = Config(maxStaleness_, maxDeviationBps_, minSources_);
    }

    /// @notice Enregistre une source de prix supplémentaire pour `assetId`.
    /// @param assetId Actif concerné.
    /// @param source Source à ajouter.
    function addPriceSource(bytes32 assetId, address source) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) {
        _sources[assetId].push(source);
        emit PriceSourceAdded(assetId, source);
    }

    /// @notice Retire une source de prix de `assetId`.
    /// @dev Retrait par permutation avec le dernier élément puis `pop` : l'ordre des sources
    ///      n'a aucune importance, seule compte leur médiane.
    /// @param assetId Actif concerné.
    /// @param source Source à retirer.
    function removePriceSource(bytes32 assetId, address source) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) {
        address[] storage list = _sources[assetId];
        uint256 len = list.length;
        for (uint256 i = 0; i < len; i++) {
            if (list[i] == source) {
                list[i] = list[len - 1];
                list.pop();
                emit PriceSourceRemoved(assetId, source);
                return;
            }
        }
        revert SourceNotRegistered(assetId, source);
    }

    /// @notice Met à jour les paramètres d'agrégation pour tous les actifs.
    /// @param maxStaleness_ Nouvelle ancienneté maximale, en secondes.
    /// @param maxDeviationBps_ Nouvel écart maximal toléré, en points de base.
    /// @param minSources_ Nouveau nombre minimal de sources fraîches.
    function setConfig(
        uint256 maxStaleness_,
        uint256 maxDeviationBps_,
        uint256 minSources_
    ) external onlyRole(accessManager.ASSET_MANAGER_ROLE()) {
        config = Config(maxStaleness_, maxDeviationBps_, minSources_);
        emit ConfigUpdated(maxStaleness_, maxDeviationBps_, minSources_);
    }

    /// @notice Prix médian de `assetId` sur toutes les sources enregistrées et fraîches, en 18
    ///         décimales.
    /// @param assetId Actif dont on veut le prix.
    /// @return price Prix médian agrégé.
    /// @return worstUpdatedAt Le plus ancien `updatedAt` parmi les sources retenues dans
    ///         l'agrégat, c'est-à-dire la borne de fraîcheur au pire des cas sur laquelle un
    ///         appelant peut s'appuyer.
    function getPrice(bytes32 assetId) external view returns (uint256 price, uint256 worstUpdatedAt) {
        address[] storage sources = _sources[assetId];
        uint256 len = sources.length;

        uint256[] memory fresh = new uint256[](len);
        uint256 freshCount;
        worstUpdatedAt = type(uint256).max;

        for (uint256 i = 0; i < len; i++) {
            // Une source qui revert (flux hors service, round périmé, données invalides...) est
            // exclue exactement comme le serait un prix périmé ou nul — elle n'entraîne jamais
            // l'échec de toute l'agrégation.
            try IPriceSource(sources[i]).latestPrice(assetId) returns (uint256 p, uint256 updatedAt) {
                if (p == 0 || block.timestamp - updatedAt > config.maxStaleness) continue;
                fresh[freshCount++] = p;
                if (updatedAt < worstUpdatedAt) worstUpdatedAt = updatedAt;
            } catch {
                continue;
            }
        }

        if (freshCount < config.minSources) {
            revert InsufficientFreshSources(assetId, freshCount, config.minSources);
        }

        uint256[] memory prices = new uint256[](freshCount);
        for (uint256 i = 0; i < freshCount; i++) {
            prices[i] = fresh[i];
        }

        uint256 minPrice = prices[0];
        uint256 maxPrice = prices[0];
        for (uint256 i = 1; i < freshCount; i++) {
            if (prices[i] < minPrice) minPrice = prices[i];
            if (prices[i] > maxPrice) maxPrice = prices[i];
        }
        if (((maxPrice - minPrice) * BPS_DENOMINATOR) / minPrice > config.maxDeviationBps) {
            revert PriceDeviationTooHigh(assetId, minPrice, maxPrice);
        }

        price = _median(prices);
    }

    /// @notice Médiane d'un tableau de prix.
    /// @dev Tri par insertion, sur place : le nombre de sources par actif se compte sur les
    ///      doigts d'une main, donc un tri en O(n²) coûte moins cher en gaz que n'importe quel
    ///      algorithme plus savant.
    /// @param prices Prix à agréger ; le tableau est trié sur place.
    /// @return Médiane, moyenne des deux valeurs centrales si le nombre de prix est pair.
    function _median(uint256[] memory prices) private pure returns (uint256) {
        uint256 n = prices.length;
        for (uint256 i = 1; i < n; i++) {
            uint256 key = prices[i];
            uint256 j = i;
            while (j > 0 && prices[j - 1] > key) {
                prices[j] = prices[j - 1];
                j--;
            }
            prices[j] = key;
        }
        return n % 2 == 1 ? prices[n / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2;
    }
}
