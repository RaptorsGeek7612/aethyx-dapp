// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Registre central des rôles pour l'ensemble du protocole AETHYX Gateway.
/// @dev Tous les autres contrats (VaultManager, GLDToken, OracleManager, Treasury, les
///      fabriques d'actifs, AethyxGateway, les adaptateurs d'actifs) détiennent une
///      référence immuable vers ce contrat et y vérifient les rôles via AccessManaged, au lieu
///      de gérer chacun son propre AccessControl. Les permissions peuvent ainsi être
///      accordées, révoquées ou permutées pour tout le protocole depuis un point unique.
contract AccessManager is AccessControl {
    /// @notice Permet d'enregistrer ou de retirer des adaptateurs d'actifs et des tokens
    ///         wrappés dans VaultManager.
    bytes32 public constant ASSET_MANAGER_ROLE = keccak256("ASSET_MANAGER_ROLE");

    /// @notice Détenu exclusivement par VaultManager ; autorise l'émission et la destruction
    ///         des tokens wrappés.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Permet de pousser des prix dans la source manuelle / API d'OracleManager.
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");

    /// @notice Permet de retirer du Treasury les frais de protocole accumulés.
    bytes32 public constant TREASURY_MANAGER_ROLE = keccak256("TREASURY_MANAGER_ROLE");

    /// @notice Permet de mettre en pause ou de réactiver les points d'entrée utilisateur
    ///         (Gateway, VaultManager, CDPManager).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Permet d'enregistrer un type de collatéral dans CDPManager et d'en ajuster les
    ///         paramètres de risque (ratio minimal, seuil de liquidation, plafond d'emprunt).
    bytes32 public constant RISK_MANAGER_ROLE = keccak256("RISK_MANAGER_ROLE");

    /// @notice Détenu exclusivement par CDPManager ; autorise l'émission et la destruction du
    ///         stablecoin de dette. Distinct de MINTER_ROLE (réservé à VaultManager) pour que
    ///         chacun des deux invariants — offre wrappée == collatéral verrouillé d'un côté,
    ///         dette émise == dette due de l'autre — reste vérifiable sans dépendre de l'autre
    ///         contrat.
    bytes32 public constant DEBT_MINTER_ROLE = keccak256("DEBT_MINTER_ROLE");

    /// @notice Détenu par chaque fabrique d'actifs (GoldAssetFactory, SilverAssetFactory,
    ///         RealEstateAssetFactory...) ; autorise l'enregistrement de nouveaux adaptateurs
    ///         et tokens.
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    /// @notice Détenu exclusivement par AethyxGateway ; lui permet d'appeler les
    ///         depositFor/redeemFor de VaultManager pour le compte de son propre appelant. Ne
    ///         jamais l'accorder à quoi que ce soit susceptible de transmettre une adresse
    ///         autre que son propre msg.sender immédiat — c'est ce rôle qui permet à
    ///         VaultManager de faire confiance à une adresse de déposant ou de racheteur
    ///         explicite plutôt que de toujours s'en tenir à msg.sender.
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    /// @notice Rôle d'administration de ROUTER_ROLE, délibérément orphelin : personne ne le
    ///         détient et personne ne le détiendra jamais, puisque rien ne l'accorde. Une fois
    ///         que `lockRouterRole` a pointé l'administration de ROUTER_ROLE ici, ROUTER_ROLE
    ///         devient définitivement figé sur son attributaire — pas même DEFAULT_ADMIN_ROLE
    ///         ne peut plus l'accorder ni le révoquer. C'est ce qui empêche le périmètre de
    ///         confiance décrit dans la natspec de ROUTER_ROLE de s'élargir après déploiement.
    bytes32 public constant ROUTER_ROLE_ADMIN = keccak256("ROUTER_ROLE_ADMIN");

    /// @notice ROUTER_ROLE a déjà été attribué et verrouillé ; l'opération est unique.
    error RouterAlreadySet();

    /// @param initialAdmin Devrait être un multisig ou un timelock en production, pas un EOA :
    ///        cette adresse peut accorder et révoquer tous les rôles ci-dessus, y compris le
    ///        sien.
    constructor(address initialAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }

    /// @notice Configuration unique : accorde ROUTER_ROLE à `gateway`, puis le verrouille
    ///         définitivement en pointant son rôle d'administration vers ROUTER_ROLE_ADMIN,
    ///         un rôle sans membre. Séparé du constructeur parce qu'AccessManager doit exister
    ///         avant qu'AethyxGateway puisse être déployé (celui-ci prend son adresse), donc
    ///         l'adresse du gateway n'est pas encore connue à la construction.
    /// @dev L'ordre compte : c'est d'accorder avant de verrouiller qui rend l'attribution
    ///      possible — en inversant les deux appels, ROUTER_ROLE naîtrait sans membre et sans
    ///      aucun moyen d'en obtenir un.
    /// @param gateway Adresse d'AethyxGateway à qui accorder ROUTER_ROLE.
    function lockRouterRole(address gateway) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (getRoleAdmin(ROUTER_ROLE) == ROUTER_ROLE_ADMIN) revert RouterAlreadySet();
        _grantRole(ROUTER_ROLE, gateway);
        _setRoleAdmin(ROUTER_ROLE, ROUTER_ROLE_ADMIN);
    }
}
