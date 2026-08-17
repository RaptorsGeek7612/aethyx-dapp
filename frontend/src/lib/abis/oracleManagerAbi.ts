// Auto-extracted from backend/artifacts. Regenerate after changing the source contract.
export const oracleManagerAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "accessManager_",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "maxStaleness_",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxDeviationBps_",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minSources_",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "assetId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "found",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "required",
        "type": "uint256"
      }
    ],
    "name": "InsufficientFreshSources",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "assetId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "minPrice",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxPrice",
        "type": "uint256"
      }
    ],
    "name": "PriceDeviationTooHigh",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "assetId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "source",
        "type": "address"
      }
    ],
    "name": "SourceNotRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      }
    ],
    "name": "Unauthorized",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxStaleness",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxDeviationBps",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "minSources",
        "type": "uint256"
      }
    ],
    "name": "ConfigUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "assetId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "source",
        "type": "address"
      }
    ],
    "name": "PriceSourceAdded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "assetId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "source",
        "type": "address"
      }
    ],
    "name": "PriceSourceRemoved",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "accessManager",
    "outputs": [
      {
        "internalType": "contract AccessManager",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "assetId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "source",
        "type": "address"
      }
    ],
    "name": "addPriceSource",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "config",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "maxStaleness",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxDeviationBps",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minSources",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "assetId",
        "type": "bytes32"
      }
    ],
    "name": "getPrice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "price",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "worstUpdatedAt",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "assetId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "source",
        "type": "address"
      }
    ],
    "name": "removePriceSource",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "maxStaleness_",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxDeviationBps_",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minSources_",
        "type": "uint256"
      }
    ],
    "name": "setConfig",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
