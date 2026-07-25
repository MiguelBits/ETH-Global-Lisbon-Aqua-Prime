// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Calldata } from "@1inch/solidity-utils/contracts/libraries/Calldata.sol";
import { Context, ContextLib } from "../libs/VM.sol";

interface IWithdrawableLending {
    function withdrawable(address user) external view returns (uint256);
}

library SolvencyGuardArgsBuilder {
    function build(address lendingPool) internal pure returns (bytes memory) {
        return abi.encodePacked(lendingPool);
    }
}

/// @title SolvencyGuard
/// @notice Ensures maker wallet + withdrawable lending balance covers tokenOut delivery
contract SolvencyGuard {
    using Calldata for bytes;
    using ContextLib for Context;

    error SolvencyGuardMissingLendingPoolArg();
    error InsufficientProducibleLiquidity(
        address maker,
        address tokenOut,
        uint256 walletBalance,
        uint256 withdrawable,
        uint256 required
    );

    /// @param args.lendingPool | 20 bytes
    function _solvencyGuard(Context memory ctx, bytes calldata args) internal view {
        address lendingPool = address(bytes20(args.slice(0, 20, SolvencyGuardMissingLendingPoolArg.selector)));

        uint256 walletBalance = IERC20(ctx.query.tokenOut).balanceOf(ctx.query.maker);
        uint256 withdrawable = IWithdrawableLending(lendingPool).withdrawable(ctx.query.maker);
        uint256 producible = walletBalance + withdrawable;

        require(
            producible >= ctx.swap.amountOut,
            InsufficientProducibleLiquidity(
                ctx.query.maker,
                ctx.query.tokenOut,
                walletBalance,
                withdrawable,
                ctx.swap.amountOut
            )
        );
    }
}
