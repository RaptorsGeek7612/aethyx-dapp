// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessManaged } from "./access/AccessManaged.sol";

/// @notice Réceptacle passif des frais du protocole. Ignore délibérément tout des actifs, des
///         taux de frais et de ce qui lui est dû — VaultManager décide de ce qu'il envoie ici
///         à chaque émission et chaque rachat, et ce contrat n'a jamais qu'à laisser un rôle
///         autorisé retirer le solde qu'il se trouve détenir.
contract Treasury is AccessManaged {
    using SafeERC20 for IERC20;

    /// @notice Émis lors du retrait de frais en ERC-20.
    /// @param token Token retiré.
    /// @param to Destinataire.
    /// @param amount Quantité retirée.
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    /// @notice Émis lors du retrait de frais en ETH.
    /// @param to Destinataire.
    /// @param amount Quantité retirée.
    event EthWithdrawn(address indexed to, uint256 amount);

    /// @notice L'envoi d'ETH au destinataire a échoué.
    /// @param to Destinataire visé.
    /// @param amount Quantité que l'on tentait d'envoyer.
    error EthTransferFailed(address to, uint256 amount);

    /// @param accessManager_ Adresse de l'AccessManager du protocole.
    constructor(address accessManager_) AccessManaged(accessManager_) {}

    /// @notice Accepte l'ETH envoyé sans données d'appel, afin que des frais libellés en ETH
    ///         puissent s'accumuler ici.
    receive() external payable {}

    /// @notice Envoie à `to` la quantité `amount` du token `token` détenue par le trésor.
    /// @param token Token ERC-20 à retirer.
    /// @param to Destinataire.
    /// @param amount Quantité à retirer.
    function withdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(accessManager.TREASURY_MANAGER_ROLE()) {
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    /// @notice Envoie à `to` la quantité `amount` d'ETH détenue par le trésor.
    /// @param to Destinataire.
    /// @param amount Quantité d'ETH à retirer.
    function withdrawEth(address payable to, uint256 amount) external onlyRole(accessManager.TREASURY_MANAGER_ROLE()) {
        (bool success, ) = to.call{ value: amount }("");
        if (!success) revert EthTransferFailed(to, amount);
        emit EthWithdrawn(to, amount);
    }
}
