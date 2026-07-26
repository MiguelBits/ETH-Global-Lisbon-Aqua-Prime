// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Context, SwapQuery, SwapRegisters, VM, ContextLib } from "../libs/VM.sol";
import { CalldataPtrLib } from "@1inch/solidity-utils/contracts/libraries/CalldataPtr.sol";
import { AquaOpcodesDebug } from "../opcodes/AquaOpcodesDebug.sol";

/**
 * @title PrimeSelector — maker-side smart order routing via Extruction
 * @notice Runs several DIFFERENT sub-programs on the SAME shipped balances and picks the branch that best
 *         serves the maker's book, not the branch that pays the taker most.
 */
contract PrimeSelector is AquaOpcodesDebug {
    using ContextLib for Context;

    error PrimeSelectorInvalidArgs();
    error PrimeSelectorNoBranches();

    uint256 private constant SCALE = 1e18;

    struct BranchResult {
        uint256 amountOut;
        int256 score;
        uint256 postSkewE18;
    }

    /// @dev Winner index + post-trade skew of the most recent EXECUTED (non-static) route, exposed for the
    ///      gateway's SwapRouted event so settlement never has to re-simulate the branches. Transient: written
    ///      only on the swap path (never in the static quote path, keeping quote() a side-effect-free
    ///      staticcall) and auto-cleared at end of transaction.
    uint8 private transient _lastWinnerIndex;
    uint256 private transient _lastPostSkewE18;

    constructor(address aqua) AquaOpcodesDebug(aqua) {}

    /// @notice Winner index + post-trade skew of the last executed (non-static) route in this transaction.
    /// @dev Read by the gateway right after `ROUTER.swap` instead of running a second branch simulation.
    function lastRoute() external view returns (uint8 winnerIndex, uint256 postSkewE18) {
        return (_lastWinnerIndex, _lastPostSkewE18);
    }

    /// @notice UI helper: score every routing branch on the current virtual book (staticcall-safe).
    function simulateBranches(
        SwapQuery calldata query,
        SwapRegisters calldata swap,
        bytes calldata args,
        bytes calldata takerData
    ) external returns (BranchResult[] memory results, uint8 winnerIndex) {
        (results, winnerIndex,,) = _route(true, query, swap, args, takerData, true);
    }

    function extruction(
        bool isStaticContext,
        uint256 nextPC,
        SwapQuery calldata query,
        SwapRegisters calldata swap,
        bytes calldata args,
        bytes calldata takerData
    ) external returns (
        uint256 updatedNextPC,
        uint256 choppedLength,
        SwapRegisters memory updatedSwap
    ) {
        uint8 winnerIndex;
        uint256 winnerPostSkew;
        (, winnerIndex, winnerPostSkew, updatedSwap) = _route(isStaticContext, query, swap, args, takerData, false);
        // Persist the executed route for the gateway event. Skipped in the static (quote) path so quote()
        // performs no state writes and remains staticcall-safe; return values are identical in both paths.
        if (!isStaticContext) {
            _lastWinnerIndex = winnerIndex;
            _lastPostSkewE18 = winnerPostSkew;
        }
        updatedNextPC = nextPC;
        choppedLength = 0;
    }

    /// @param record When true, allocates and fills the per-branch `results` array (UI simulation path).
    ///        The executed swap path passes false to skip that allocation — only the winner registers are
    ///        needed, so the winning `SwapRegisters` is committed directly to the VM.
    function _route(
        bool isStaticContext,
        SwapQuery calldata query,
        SwapRegisters calldata swap,
        bytes calldata args,
        bytes calldata takerData,
        bool record
    ) internal returns (
        BranchResult[] memory results,
        uint8 winnerIndex,
        uint256 winnerPostSkewE18,
        SwapRegisters memory bestSwap
    ) {
        require(args.length >= 17, PrimeSelectorInvalidArgs());

        uint256 lambda = uint128(bytes16(args[0:16]));
        uint8 numBranches = uint8(args[16]);
        require(numBranches > 0, PrimeSelectorNoBranches());

        if (record) {
            results = new BranchResult[](numBranches);
        }
        // Build the opcode dispatch table once and share it across every branch (it is identical for all).
        function(Context memory, bytes calldata) internal[] memory ops = _opcodes();

        bool isExactIn = query.isExactIn;
        bool found;
        int256 bestScore;
        bestSwap = swap;

        uint256 offset = 17;
        for (uint256 i = 0; i < numBranches; i++) {
            require(offset + 2 <= args.length, PrimeSelectorInvalidArgs());
            uint16 branchLen = uint16(bytes2(args[offset:offset + 2]));
            offset += 2;
            require(offset + branchLen <= args.length, PrimeSelectorInvalidArgs());
            bytes calldata branch = args[offset:offset + branchLen];
            offset += branchLen;

            Context memory ctx = Context({
                vm: VM({
                    isStaticContext: isStaticContext,
                    nextPC: 0,
                    programPtr: CalldataPtrLib.from(branch),
                    takerArgsPtr: CalldataPtrLib.from(takerData),
                    opcodes: ops
                }),
                query: query,
                swap: swap
            });
            (uint256 branchIn, uint256 branchOut) = ctx.runLoop();

            uint256 postSkew = _postSkewAbsE18(swap, branchIn, branchOut);
            int256 score = _score(isExactIn, branchIn, branchOut, postSkew, lambda);
            if (record) {
                results[i] = BranchResult({ amountOut: branchOut, score: score, postSkewE18: postSkew });
            }

            if (!found || score > bestScore) {
                found = true;
                bestScore = score;
                winnerIndex = uint8(i);
                winnerPostSkewE18 = postSkew;
                bestSwap = SwapRegisters({
                    balanceIn: swap.balanceIn,
                    balanceOut: swap.balanceOut,
                    amountIn: branchIn,
                    amountOut: branchOut,
                    amountNetPulled: swap.amountNetPulled
                });
            }
        }
    }

    function _score(
        bool isExactIn,
        uint256 branchIn,
        uint256 branchOut,
        uint256 postSkewE18,
        uint256 lambda
    ) internal pure returns (int256) {
        int256 takerValue = isExactIn ? int256(branchOut) : -int256(branchIn);
        uint256 penalty = Math.mulDiv(lambda, postSkewE18, SCALE);
        return takerValue - int256(penalty);
    }

    function _postSkewAbsE18(
        SwapRegisters memory swap,
        uint256 branchIn,
        uint256 branchOut
    ) internal pure returns (uint256) {
        uint256 balanceOutPost = swap.balanceOut > branchOut ? swap.balanceOut - branchOut : 0;
        uint256 balanceInPost = swap.balanceIn + branchIn;
        uint256 sum = balanceOutPost + balanceInPost;
        if (sum == 0) {
            return 0;
        }
        uint256 diff = balanceOutPost >= balanceInPost ? balanceOutPost - balanceInPost : balanceInPost - balanceOutPost;
        return Math.mulDiv(diff, SCALE, sum);
    }
}
