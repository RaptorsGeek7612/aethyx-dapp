import { readFileSync } from "node:fs";
import { network } from "hardhat";

// One-off: register-real-estate-collateral.ts computes this market's CDP price as
// appraisal ÷ totalSupply(wrappedToken), so it refuses to run against a market nobody has
// deposited into yet (division by zero). REAL_ESTATE_PARIS_01_V8 was just deployed fresh on the
// 2026-09-15 core protocol redeploy and has zero supply — unlike V7 before it, which already had
// demo deposits from earlier sessions. Deposits 1 unit of the admin's already-whitelisted demo
// property token (minted by seed-demo-assets.ts) through the Gateway, the same path a real
// depositor would use, purely so the market has a nonzero supply to price against.
//
//   npx hardhat run scripts/seed-real-estate-v8-deposit.ts --network sepolia

const REAL_ESTATE_LABEL = "REAL_ESTATE_PARIS_01_V8";
const DEPOSIT_AMOUNT = 1n * 10n ** 18n;

const networkName = process.env.SEED_NETWORK ?? "localhost";
const { ethers } = await network.create({ network: networkName, chainType: "l1" });
const chainId = (await ethers.provider.getNetwork()).chainId;
const deploymentDir = `ignition/deployments/chain-${chainId}`;

const deployed = JSON.parse(readFileSync(`${deploymentDir}/deployed_addresses.json`, "utf8")) as Record<string, string>;
const gatewayAddress = deployed["AethyxGateway#AethyxGateway"];

const market = JSON.parse(readFileSync(`${deploymentDir}/real_estate_market.json`, "utf8")) as Record<
  string,
  { adapter: string; underlying: string; wrappedToken: string }
>;
const { adapter, underlying: underlyingAddress, wrappedToken } = market[REAL_ESTATE_LABEL];

const [admin] = await ethers.getSigners();
console.log("Depositing into", REAL_ESTATE_LABEL, "as", admin.address, "on", networkName);

const underlying = await ethers.getContractAt("MockERC3643", underlyingAddress);
const gateway = await ethers.getContractAt("AethyxGateway", gatewayAddress);
const wrapped = await ethers.getContractAt(["function totalSupply() view returns (uint256)"], wrappedToken);

const balance = await underlying.balanceOf(admin.address);
if (balance < DEPOSIT_AMOUNT) {
  throw new Error(`admin only holds ${ethers.formatUnits(balance, 18)} of the underlying — need at least 1`);
}

const allowance = await underlying.allowance(admin.address, adapter);
if (allowance < DEPOSIT_AMOUNT) {
  await (await underlying.connect(admin).approve(adapter, DEPOSIT_AMOUNT)).wait();
  console.log("Approved adapter", adapter, "for", ethers.formatUnits(DEPOSIT_AMOUNT, 18));
}

await (await gateway.connect(admin).deposit(ethers.id(REAL_ESTATE_LABEL), DEPOSIT_AMOUNT)).wait();
console.log("Deposited", ethers.formatUnits(DEPOSIT_AMOUNT, 18), "— new supply:", ethers.formatUnits(await wrapped.totalSupply(), 18));
