// Read/write surface the frontend needs from CDPManager — position lifecycle plus the two live
// reads (currentDebt, collateralRatioBps) that already fold in stability-fee accrual, so the UI
// never has to reimplement that math to show an up-to-date number between transactions.
export const cdpManagerAbi = [
  {
    type: "function",
    name: "collaterals",
    stateMutability: "view",
    inputs: [{ name: "collateralId", type: "bytes32" }],
    outputs: [
      { name: "wrappedToken", type: "address" },
      { name: "minCollateralRatioBps", type: "uint16" },
      { name: "liquidationThresholdBps", type: "uint16" },
      { name: "stabilityFeeBps", type: "uint16" },
      { name: "debtCeiling", type: "uint256" },
      { name: "totalDebt", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "collateralId", type: "bytes32" },
    ],
    outputs: [
      { name: "collateralAmount", type: "uint256" },
      { name: "debtAmount", type: "uint256" },
      { name: "lastAccrualTimestamp", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "currentDebt",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "collateralId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "collateralRatioBps",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "collateralId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "depositCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mintDebt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repayDebt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "collateralId", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;
