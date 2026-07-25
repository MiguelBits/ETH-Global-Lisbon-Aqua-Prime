export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
] as const;

export const wethAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "deposit",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

/** Sepolia PrimeFaucetToken: ERC20 + open faucet/mint for demos. */
export const faucetTokenAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "faucet",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "faucetAmount",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const aquaAbi = [
  {
    type: "function",
    name: "dock",
    inputs: [
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "tokens", type: "address[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "ship",
    inputs: [
      { name: "app", type: "address" },
      { name: "strategy", type: "bytes" },
      { name: "tokens", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [{ name: "strategyHash", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rawBalances",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token", type: "address" },
    ],
    outputs: [
      { name: "balance", type: "uint248" },
      { name: "tokensCount", type: "uint8" },
    ],
    stateMutability: "view",
  },
] as const;

export const deskSetComponents = [
  { name: "healK", type: "uint64" },
  { name: "maxAdjustment", type: "uint64" },
  { name: "healPremium", type: "uint64" },
  { name: "lambda", type: "uint128" },
  { name: "deadline", type: "uint64" },
  { name: "attestation", type: "bytes32" },
] as const;

export const aquaPrimeGatewayAbi = [
  {
    type: "error",
    name: "AquaPrimeGatewayNotSwapVM",
    inputs: [],
  },
  {
    type: "error",
    name: "AquaPrimeGatewayDeskAlreadyRecorded",
    inputs: [],
  },
  {
    type: "error",
    name: "AquaPrimeGatewayOnlyMaker",
    inputs: [],
  },
  {
    type: "error",
    name: "AquaPrimeGatewayDeskSetExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "AquaPrimeGatewayDeskSetCaps",
    inputs: [],
  },
  {
    type: "error",
    name: "AquaPrimeGatewayNoPendingDeskSet",
    inputs: [],
  },
  {
    type: "error",
    name: "AquaPrimeGatewayPendingDeskSet",
    inputs: [],
  },
  {
    type: "error",
    name: "AquaPrimeGatewayPendingNotShipped",
    inputs: [],
  },
  {
    type: "error",
    name: "AquaPrimeGatewayMustFinishPendingShip",
    inputs: [],
  },
  {
    type: "event",
    name: "DeskShipped",
    inputs: [
      { name: "maker", type: "address", indexed: true },
      { name: "strategyHash", type: "bytes32", indexed: true },
      { name: "baseToken", type: "address", indexed: true },
      { name: "quoteToken", type: "address", indexed: false },
      { name: "baseBal", type: "uint256", indexed: false },
      { name: "quoteBal", type: "uint256", indexed: false },
      { name: "ensName", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DeskSetStaged",
    inputs: [
      { name: "maker", type: "address", indexed: true },
      { name: "oldStrategyHash", type: "bytes32", indexed: true },
      { name: "pendingStrategyHash", type: "bytes32", indexed: true },
      { name: "balBase", type: "uint256", indexed: false },
      { name: "balQuote", type: "uint256", indexed: false },
      { name: "healK", type: "uint64", indexed: false },
      { name: "maxAdjustment", type: "uint64", indexed: false },
      { name: "healPremium", type: "uint64", indexed: false },
      { name: "lambda", type: "uint128", indexed: false },
      { name: "attestation", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DeskSetCommitted",
    inputs: [
      { name: "maker", type: "address", indexed: true },
      { name: "strategyHash", type: "bytes32", indexed: true },
      { name: "healK", type: "uint64", indexed: false },
      { name: "maxAdjustment", type: "uint64", indexed: false },
      { name: "healPremium", type: "uint64", indexed: false },
      { name: "lambda", type: "uint128", indexed: false },
      { name: "attestation", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SwapRouted",
    inputs: [
      { name: "maker", type: "address", indexed: true },
      { name: "taker", type: "address", indexed: true },
      { name: "sellBase", type: "bool", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "winnerIndex", type: "uint8", indexed: false },
      { name: "postSkewE18", type: "uint256", indexed: false },
      { name: "baseBalAfter", type: "uint256", indexed: false },
      { name: "quoteBalAfter", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "stageDeskSet",
    inputs: [{ name: "s", type: "tuple", components: deskSetComponents }],
    outputs: [
      { name: "oldHash", type: "bytes32" },
      { name: "balBase", type: "uint256" },
      { name: "balQuote", type: "uint256" },
      { name: "strategy", type: "bytes" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "finalizeDeskSet",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "abandonPendingDeskSet",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "pendingStrategy",
    inputs: [],
    outputs: [{ type: "bytes" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasPendingDeskSet",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingStrategyHash",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingBalBase",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingBalQuote",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activeDeskSet",
    inputs: [],
    outputs: [
      { name: "healK", type: "uint64" },
      { name: "maxAdjustment", type: "uint64" },
      { name: "healPremium", type: "uint64" },
      { name: "lambda", type: "uint128" },
      { name: "deadline", type: "uint64" },
      { name: "attestation", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "AQUA",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ROUTER",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "strategyHash",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteExactIn",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "sellBase", type: "bool" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteBaseToQuote",
    inputs: [{ name: "amountIn", type: "uint256" }],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteQuoteToBase",
    inputs: [{ name: "amountIn", type: "uint256" }],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "swapExactIn",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "sellBase", type: "bool" },
    ],
    outputs: [
      { name: "actualIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "swapBaseForQuote",
    inputs: [{ name: "amountIn", type: "uint256" }],
    outputs: [
      { name: "actualIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "swapQuoteForBase",
    inputs: [{ name: "amountIn", type: "uint256" }],
    outputs: [
      { name: "actualIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "virtualBalances",
    inputs: [],
    outputs: [
      { name: "balBase", type: "uint256" },
      { name: "balQuote", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteBranchBreakdown",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "sellBase", type: "bool" },
    ],
    outputs: [
      { name: "primeOut", type: "uint256" },
      { name: "branchOuts", type: "uint256[4]" },
      { name: "scores", type: "int256[4]" },
      { name: "postSkewE18", type: "uint256[4]" },
      { name: "winnerIndex", type: "uint8" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "MAKER",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "BASE",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "QUOTE",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "STRATEGY_HASH",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SELECTOR",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deskRecorded",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
] as const;

/** Chainlink AggregatorV3Interface (ETH/USD). */
export const chainlinkAggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
] as const;
