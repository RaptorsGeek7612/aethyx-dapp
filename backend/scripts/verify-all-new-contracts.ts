import { tasks } from "hardhat";
import { id as keccakId } from "ethers";

// One-off, round 2: the first pass mostly failed with HHE80009 ("bytecode doesn't match any
// local contract") because `npx hardhat run` had recompiled with the *default* build profile
// (no optimizer) in between deployment and verification, overwriting the artifacts that were
// used for the actual `production`-profile deployment. Re-run after `npx hardhat build
// --build-profile production` (or pass --build-profile production to this same `run` command) so
// the on-disk artifacts match on-chain bytecode again. The three constructor-arg failures
// (HHE80018) needed explicit constructorArgs — hardhat-verify couldn't infer them for these.

const ADDRESS_ONLY = [
  { name: "AccessManager", address: "0xf9c34A30845353F7B91a6655f80c03417b1f659F" },
  { name: "OracleManager", address: "0x356eF62639e8Fd2c932E0c059Ed2C7Dca96AE96d" },
  { name: "VaultManager", address: "0xd3aB44E886f9ACf8109598a497F1F9d23CA98496" },
  { name: "GoldAssetFactory", address: "0x8e9B45B41BEa26cb2850042eE26e9f23230E2795" },
  { name: "RealEstateAssetFactory", address: "0xd6EB26771daD2FF538b4e317f3cdAdd45bCC40fA" },
  { name: "SilverAssetFactory", address: "0x063FF031780cE9b0824bE18AC75A54d8C8AD7B2a" },
  { name: "GOLD adapter", address: "0xFc80cd8c1CB8E606a750ec0254307DDa7D3f46C6" },
  { name: "GOLD wrapped (GLD)", address: "0x8Ed96b297214d46E032FD9804E1F5cB482599953" },
  { name: "SILVER adapter", address: "0x9BAF47928138FAA7B4275B0A5dBe4637dE77a354" },
  { name: "SILVER wrapped (SLD)", address: "0x51a536b24716A80D00B163d6BA18D8E257a50f88" },
];

const CHAINLINK_XAU_USD_SOURCE = "0x8e6ded34eeE24F6270F696eeDFfbD479Dd0bdb4A";
const NEW_PRICE_SOURCE_PRIMARY = "0x16A1f7EF1DcEE3d8CeCBb24751869E53986634D7";
const EUR_USD_RATE_ASSET_ID = keccakId("EUR_USD_RATE");

const WITH_CONSTRUCTOR_ARGS: Array<{ name: string; address: string; constructorArgs: string[] }> = [
  {
    name: "ChainlinkGoldEurPerGramPriceSource #1",
    address: "0x3598965844edC09d109369a0437aceE0c05A8136",
    constructorArgs: [CHAINLINK_XAU_USD_SOURCE, NEW_PRICE_SOURCE_PRIMARY, EUR_USD_RATE_ASSET_ID],
  },
  {
    name: "ChainlinkGoldEurPerGramPriceSource #2",
    address: "0x0a004F2e3c5a3cf8048CDe132829d0B08b43592b",
    constructorArgs: [CHAINLINK_XAU_USD_SOURCE, NEW_PRICE_SOURCE_PRIMARY, EUR_USD_RATE_ASSET_ID],
  },
  {
    name: "REAL_ESTATE_PARIS_01_V8 adapter",
    address: "0xb1b7d1f82C5A185521dE718D56CbEA8c92fEfA98",
    constructorArgs: [
      "0xA8a3F8cE130b2267A4f7f59bD0769Bf631A0316E", // underlying
      "0xd3aB44E886f9ACf8109598a497F1F9d23CA98496", // VaultManager
      keccakId("REAL_ESTATE_PARIS_01_V8"), // assetId
      String(30n * 24n * 60n * 60n), // lockupPeriod (30 days, seconds)
    ],
  },
];

const verifySourcify = tasks.getTask(["verify", "sourcify"]);

const results: Array<{ name: string; address: string; ok: boolean; error?: string }> = [];

for (const { name, address } of ADDRESS_ONLY) {
  console.log(`\n=== ${name} (${address}) ===`);
  try {
    await verifySourcify.run({ address });
    results.push({ name, address, ok: true });
  } catch (error) {
    console.log("FAILED:", error instanceof Error ? error.message : error);
    results.push({ name, address, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

for (const { name, address, constructorArgs } of WITH_CONSTRUCTOR_ARGS) {
  console.log(`\n=== ${name} (${address}) ===`);
  try {
    await verifySourcify.run({ address, constructorArgs });
    results.push({ name, address, ok: true });
  } catch (error) {
    console.log("FAILED:", error instanceof Error ? error.message : error);
    results.push({ name, address, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log("\n\n=== Summary ===");
for (const r of results) {
  console.log(r.ok ? "OK  " : "FAIL", r.name.padEnd(45), r.address, r.error ?? "");
}
