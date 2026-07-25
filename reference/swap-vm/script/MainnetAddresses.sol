// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @title MainnetAddresses
/// @notice Canonical 1inch Aqua / SwapVM deployments on Ethereum mainnet (chainId 1).
/// @dev Use these on a mainnet fork — do NOT `new Aqua()` or redeploy the registry.
///      Aqua Prime still deploys a custom `AquaSwapVMRouter` when using project opcodes (e.g. SkewPricer).
library MainnetAddresses {
    /// @notice Aqua registry (@1inch/aqua-sdk constants, multi-chain CREATE2)
    address internal constant AQUA = 0x4a055AA172C98ec32de118B9B5b6AC8B4099A580;

    /// @notice AquaRouter (Aqua + Simulator + Multicall) per aqua README
    address internal constant AQUA_ROUTER = 0x499943E74FB0cE105688beeE8Ef2ABec5D936d31;

    /// @notice Stock SwapVM router (no custom opcodes)
    address internal constant SWAP_VM = 0x8fDD04Dbf6111437B44bbca99C28882434e0958f;
}
