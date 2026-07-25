// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

/// @title SepoliaAddresses
/// @notice Canonical Sepolia addresses used by the Prime Desk deploy.
/// @dev WETH/USDC are deployed fresh as mintable faucet tokens (see PrimeFaucetToken) so the
///      demo never depends on external testnet faucets. Only the Chainlink ETH/USD feed is a
///      live Sepolia contract.
library SepoliaAddresses {
    /// @notice Chainlink ETH/USD price feed on Sepolia (8 decimals).
    address internal constant CHAINLINK_ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
}
