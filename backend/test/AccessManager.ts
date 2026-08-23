import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

/**
 * ROUTER_ROLE — périmètre de confiance figé.
 *
 * VaultManager.depositFor/redeemFor font confiance à leur appelant pour dire *qui* est
 * l'utilisateur (voir VaultManager.sol). InvestOrGateway mérite cette confiance : il ne
 * transmet jamais que son propre msg.sender. Mais rien, dans AccessControl vanilla,
 * n'empêche DEFAULT_ADMIN_ROLE d'accorder ROUTER_ROLE à un second contrat qui, lui,
 * passerait une adresse arbitraire — la faille n'est pas dans le Gateway, elle est dans le
 * fait que le périmètre de confiance pourrait grandir après le déploiement.
 *
 * lockRouterRole ferme cette porte : il accorde ROUTER_ROLE au Gateway puis pointe son
 * admin vers ROUTER_ROLE_ADMIN, un rôle que personne ne détient et que rien n'accorde
 * jamais. Ces tests prouvent que la porte reste fermée, y compris pour l'admin lui-même.
 */
describe("AccessManager — ROUTER_ROLE figé après déploiement", () => {
  async function deployFixture() {
    const [admin, attacker, victim] = await ethers.getSigners();

    const accessManager = await ethers.deployContract("AccessManager", [admin.address]);
    const treasury = await ethers.deployContract("Treasury", [accessManager.target]);
    const vaultManager = await ethers.deployContract("VaultManager", [accessManager.target, treasury.target]);
    const gateway = await ethers.deployContract("InvestOrGateway", [accessManager.target, vaultManager.target]);

    await accessManager.lockRouterRole(gateway.target);

    return { accessManager, vaultManager, gateway, admin, attacker, victim };
  }

  it("accorde ROUTER_ROLE au Gateway et à lui seul", async () => {
    const { accessManager, gateway, attacker } = await networkHelpers.loadFixture(deployFixture);
    const ROUTER_ROLE = await accessManager.ROUTER_ROLE();

    expect(await accessManager.hasRole(ROUTER_ROLE, gateway.target)).to.be.true;
    expect(await accessManager.hasRole(ROUTER_ROLE, attacker.address)).to.be.false;
  });

  it("empêche même l'admin d'accorder ROUTER_ROLE après l'initialisation", async () => {
    const { accessManager, admin, attacker } = await networkHelpers.loadFixture(deployFixture);
    const ROUTER_ROLE = await accessManager.ROUTER_ROLE();

    // admin détient DEFAULT_ADMIN_ROLE, mais plus ROUTER_ROLE_ADMIN — lockRouterRole a
    // déjà déplacé l'administration de ROUTER_ROLE vers un rôle orphelin.
    await expect(accessManager.connect(admin).grantRole(ROUTER_ROLE, attacker.address)).to.be.revertedWithCustomError(
      accessManager,
      "AccessControlUnauthorizedAccount",
    );
  });

  it("ROUTER_ROLE_ADMIN n'a aucun membre", async () => {
    // Pas d'AccessControlEnumerable ici pour énumérer tous les détenteurs possibles — on
    // vérifie plutôt qu'aucun compte connu, admin compris, ne le détient.
    const { accessManager, admin, attacker } = await networkHelpers.loadFixture(deployFixture);
    const ROUTER_ROLE_ADMIN = await accessManager.ROUTER_ROLE_ADMIN();

    expect(await accessManager.hasRole(ROUTER_ROLE_ADMIN, admin.address)).to.be.false;
    expect(await accessManager.hasRole(ROUTER_ROLE_ADMIN, attacker.address)).to.be.false;
  });

  it("rejette un appel direct à depositFor par un tiers", async () => {
    const { vaultManager, attacker, victim } = await networkHelpers.loadFixture(deployFixture);

    await expect(
      vaultManager.connect(attacker).depositFor(ethers.id("GOLD"), 1n, victim.address),
    ).to.be.revertedWithCustomError(vaultManager, "Unauthorized");
  });

  it("refuse de reverrouiller ROUTER_ROLE une deuxième fois", async () => {
    // Preuve de l'ordre grant-puis-lock à l'intérieur de lockRouterRole : une fois le rôle
    // verrouillé, même un second appel de l'admin échoue — il n'y a pas de fenêtre où
    // ROUTER_ROLE pourrait être réattribué ou réverrouillé sur un autre contrat.
    const { accessManager, admin, attacker } = await networkHelpers.loadFixture(deployFixture);

    await expect(accessManager.connect(admin).lockRouterRole(attacker.address)).to.be.revertedWithCustomError(
      accessManager,
      "RouterAlreadySet",
    );
  });
});
