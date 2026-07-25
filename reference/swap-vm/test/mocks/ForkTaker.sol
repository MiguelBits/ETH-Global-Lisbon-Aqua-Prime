// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@1inch/solidity-utils/contracts/libraries/SafeERC20.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { SwapVM } from "../../src/SwapVM.sol";
import { MockTaker } from "./MockTaker.sol";

/// @notice Taker helper for mainnet fork tests (USDC-safe approvals)
contract ForkTaker is MockTaker {
    using SafeERC20 for IERC20;

    constructor(Aqua aqua, SwapVM swapVM, address owner_) MockTaker(aqua, swapVM, owner_) { }

    function preTransferInCallback(
        address maker,
        address,
        address tokenIn,
        address,
        uint256 amountIn,
        uint256,
        bytes32 orderHash,
        bytes calldata
    ) public override onlySwapVM {
        IERC20(tokenIn).forceApprove(address(AQUA), amountIn);
        AQUA.push(maker, address(SWAPVM), orderHash, tokenIn, amountIn);
    }
}
