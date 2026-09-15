import { tasks } from "hardhat";
import { id as keccakId } from "ethers";

// One-off, round 3: the last 8 contracts weren't deployed via `hardhat ignition deploy` (which
// uses the `production` build profile) but via standalone `hardhat run scripts/*.ts` invocations,
// which compile with the *default* profile (no optimizer) — the opposite situation from round 2.
// Run this WITHOUT --build-profile production (plain `npx hardhat build` was already run to put
// the default-profile artifacts back on disk).
//
//   npx hardhat run scripts/verify-remaining-contracts.ts --network sepolia

const VAULT_MANAGER = "0xd3aB44E886f9ACf8109598a497F1F9d23CA98496";
const ACCESS_MANAGER = "0xf9c34A30845353F7B91a6655f80c03417b1f659F";
const CHAINLINK_XAU_USD_SOURCE = "0x8e6ded34eeE24F6270F696eeDFfbD479Dd0bdb4A";
const NEW_PRICE_SOURCE_PRIMARY = "0x16A1f7EF1DcEE3d8CeCBb24751869E53986634D7";
const EUR_USD_RATE_ASSET_ID = keccakId("EUR_USD_RATE");

const CONTRACTS: Array<{ name: string; address: string; contract?: string; constructorArgs: string[] }> = [
  {
    name: "GOLD adapter",
    address: "0xFc80cd8c1CB8E606a750ec0254307DDa7D3f46C6",
    contract: "contracts/GoldAdapter.sol:GoldAdapter",
    constructorArgs: ["0x37d273332044d30D964a9340467743F4Ac1a6639", VAULT_MANAGER, keccakId("GOLD"), "0"],
  },
  {
    name: "SILVER adapter",
    address: "0x9BAF47928138FAA7B4275B0A5dBe4637dE77a354",
    contract: "contracts/SilverAdapter.sol:SilverAdapter",
    constructorArgs: ["0xf5c896a106A561533e763AC6a7917f6Ce71775B9", VAULT_MANAGER, keccakId("SILVER"), "0"],
  },
  {
    name: "GOLD wrapped (GLD)",
    address: "0x8Ed96b297214d46E032FD9804E1F5cB482599953",
    constructorArgs: ["AETHYX Gold", "GLD", ACCESS_MANAGER],
  },
  {
    name: "SILVER wrapped (SLD)",
    address: "0x51a536b24716A80D00B163d6BA18D8E257a50f88",
    constructorArgs: ["AETHYX Silver", "SLD", ACCESS_MANAGER],
  },
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
      "0xA8a3F8cE130b2267A4f7f59bD0769Bf631A0316E",
      VAULT_MANAGER,
      keccakId("REAL_ESTATE_PARIS_01_V8"),
      String(30n * 24n * 60n * 60n),
    ],
  },
];

const verifySourcify = tasks.getTask(["verify", "sourcify"]);
const results: Array<{ name: string; address: string; ok: boolean; error?: string }> = [];

for (const { name, address, contract, constructorArgs } of CONTRACTS) {
  console.log(`\n=== ${name} (${address}) ===`);
  try {
    await verifySourcify.run({ address, constructorArgs, ...(contract ? { contract } : {}) });
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
