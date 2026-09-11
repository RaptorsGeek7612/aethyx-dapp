// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Surface de VaultManager dont ce mock a besoin pour se réentrer lui-même.
interface IVaultManagerLike {
    /// @notice Dépôt réentrant visé pendant le transferFrom du token.
    /// @param assetId Actif visé.
    /// @param amount Quantité déposée.
    /// @return Quantité de token wrappé émise.
    function deposit(bytes32 assetId, uint256 amount) external returns (uint256);

    /// @notice Rachat réentrant visé pendant le transfer du token.
    /// @param assetId Actif visé.
    /// @param wrappedAmount Quantité de token wrappé présentée.
    /// @return Quantité de sous-jacent restituée.
    function redeem(bytes32 assetId, uint256 wrappedAmount) external returns (uint256);
}

/// @notice Doublure malveillante d'un sous-jacent ERC-3643, pour les tests de réentrance
///         uniquement. Reprend la surface de conformité de MockERC3643, mais son hook
///         transferFrom peut être armé pour rappeler directement VaultManager en plein
///         transfert — exactement le chemin de rappel qu'un token réel malveillant, ou
///         simplement bogué, pourrait exploiter si VaultManager.deposit et redeem n'étaient
///         pas protégés par ReentrancyGuard. Si la protection fait son travail, l'appel
///         réentrant revert et entraîne toute la transaction externe avec lui.
contract ReentrantERC3643 is ERC20 {
    /// @notice VaultManager à rappeler lorsque le piège est armé.
    address public vaultManager;
    /// @notice Actif visé par l'appel réentrant.
    bytes32 public targetAssetId;
    /// @notice Vrai si le prochain transferFrom doit se réentrer via `deposit`.
    bool public reenterOnDeposit;
    /// @notice Vrai si le prochain transfer doit se réentrer via `redeem`.
    bool public reenterOnWithdraw;

    /// @notice Liste blanche des identités vérifiées.
    mapping(address => bool) public verified;

    /// @param name_ Nom du token.
    /// @param symbol_ Symbole du token.
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /// @notice Émet des tokens de test, sans aucun contrôle d'accès.
    /// @param to Destinataire.
    /// @param amount Quantité à émettre.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Inscrit ou retire `account` de la liste blanche.
    /// @param account Adresse concernée.
    /// @param verifiedStatus Nouvel état de vérification.
    function setVerified(address account, bool verifiedStatus) external {
        verified[account] = verifiedStatus;
    }

    /// @notice Vrai si `userAddress` figure sur la liste blanche.
    /// @param userAddress Adresse interrogée.
    /// @return Vrai si l'identité est vérifiée.
    function isVerified(address userAddress) external view returns (bool) {
        return verified[userAddress];
    }

    /// @notice Accepte toujours : ce mock teste la réentrance, pas la conformité.
    /// @return Toujours vrai.
    function canTransfer(address, address, uint256) external pure returns (bool) {
        return true;
    }

    /// @notice Arme un appel réentrant vers `vaultManager_.deposit(assetId_, amount)` au
    ///         prochain transferFrom de ce token — c'est-à-dire au moment précis où
    ///         VaultManager.deposit tire le sous-jacent vers la garde de l'adaptateur, avant
    ///         d'avoir émis quoi que ce soit.
    /// @param vaultManager_ VaultManager à rappeler.
    /// @param assetId_ Actif visé par l'appel réentrant.
    function armDepositReentrancy(address vaultManager_, bytes32 assetId_) external {
        vaultManager = vaultManager_;
        targetAssetId = assetId_;
        reenterOnDeposit = true;
    }

    /// @notice Arme un appel réentrant vers `vaultManager_.redeem(assetId_, amount)` au
    ///         prochain transfer de ce token — c'est-à-dire au moment précis où
    ///         VaultManager.redeem ressort le sous-jacent de l'adaptateur, après avoir brûlé
    ///         le versant wrappé.
    /// @param vaultManager_ VaultManager à rappeler.
    /// @param assetId_ Actif visé par l'appel réentrant.
    function armWithdrawReentrancy(address vaultManager_, bytes32 assetId_) external {
        vaultManager = vaultManager_;
        targetAssetId = assetId_;
        reenterOnWithdraw = true;
    }

    /// @inheritdoc ERC20
    /// @dev Désarme le piège avant de se réentrer, pour que la récursion s'arrête au premier
    ///      niveau : c'est bien la protection de VaultManager que l'on teste, pas une boucle
    ///      infinie.
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (reenterOnDeposit) {
            reenterOnDeposit = false;
            IVaultManagerLike(vaultManager).deposit(targetAssetId, amount);
        }
        return super.transferFrom(from, to, amount);
    }

    /// @inheritdoc ERC20
    /// @dev Même désarmement que dans `transferFrom`, côté rachat.
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (reenterOnWithdraw) {
            reenterOnWithdraw = false;
            IVaultManagerLike(vaultManager).redeem(targetAssetId, amount);
        }
        return super.transfer(to, amount);
    }
}
