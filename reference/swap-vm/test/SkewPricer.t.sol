// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ISwapVM } from "../src/SwapVM.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { Controls } from "../src/instructions/Controls.sol";
import { SkewPricer, SkewPricerArgsBuilder, SKEW_ONE } from "../src/instructions/SkewPricer.sol";
import { Program, ProgramBuilder } from "./utils/ProgramBuilder.sol";

import { AquaSwapVMTest } from "./base/AquaSwapVMTest.sol";

/// @title SkewPricer unit tests
/// @notice Correctness of the inventory-healing quote skew, proved against a plain-XYC control strategy
///         on equal-scale (18-decimal) mock tokens. Every assertion compares the skew program's output to
///         the XYC-only output on the SAME shipped virtual balances.
contract SkewPricerTest is AquaSwapVMTest {
    using ProgramBuilder for Program;

    uint64 internal constant K = 0.5e18;
    uint64 internal constant MAX_ADJ = 0.5e18;

    // ===== program builders =====

    function _skewProgram(uint64 k, uint64 maxAdj) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(SkewPricer._skewPricer, SkewPricerArgsBuilder.build(k, maxAdj)),
            p.build(Controls._salt, abi.encodePacked(vm.randomUint()))
        );
    }

    function _xycProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(vm.randomUint()))
        );
    }

    function _shipSkew(uint64 k, uint64 maxAdj, uint256 balA, uint256 balB) internal returns (ISwapVM.Order memory order) {
        order = createStrategy(_skewProgram(k, maxAdj));
        shipStrategy(order, tokenA, tokenB, balA, balB);
    }

    function _shipXyc(uint256 balA, uint256 balB) internal returns (ISwapVM.Order memory order) {
        order = createStrategy(_xycProgram());
        shipStrategy(order, tokenA, tokenB, balA, balB);
    }

    // A -> B exactIn quote (tokenOut is B; overstocked B => taker should get more B)
    function _quoteOutAtoB(ISwapVM.Order memory order, uint256 amountIn) internal view returns (uint256 amountOut) {
        SwapProgram memory sp = SwapProgram({
            amount: amountIn,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: true
        });
        (, amountOut) = quote(sp, order);
    }

    // ===== correctness invariants =====

    function test_skew_zero_balanced() public {
        uint256 bal = 1_000e18;
        ISwapVM.Order memory skewOrder = _shipSkew(K, MAX_ADJ, bal, bal);
        ISwapVM.Order memory xycOrder = _shipXyc(bal, bal);

        // skew == 0 => multiplier exactly 1.0 => identical to plain XYC
        assertEq(_quoteOutAtoB(skewOrder, 10e18), _quoteOutAtoB(xycOrder, 10e18), "balanced book must be a no-op");
    }

    function test_skew_positive_overstocked_gives_more() public {
        // out-token (B) overstocked relative to in-token (A) => heal by selling B cheaper => taker gets MORE
        ISwapVM.Order memory skewOrder = _shipSkew(K, MAX_ADJ, 1_000e18, 3_000e18);
        ISwapVM.Order memory xycOrder = _shipXyc(1_000e18, 3_000e18);

        assertGt(_quoteOutAtoB(skewOrder, 10e18), _quoteOutAtoB(xycOrder, 10e18), "overstocked out-token must give taker more");
    }

    function test_skew_negative_scarce_gives_less() public {
        // out-token (B) scarce relative to in-token (A) => protect the thin side => taker gets LESS
        ISwapVM.Order memory skewOrder = _shipSkew(K, MAX_ADJ, 3_000e18, 1_000e18);
        ISwapVM.Order memory xycOrder = _shipXyc(3_000e18, 1_000e18);

        assertLt(_quoteOutAtoB(skewOrder, 10e18), _quoteOutAtoB(xycOrder, 10e18), "scarce out-token must give taker less");
    }

    function test_skew_capped_at_max_adjustment() public {
        uint64 maxAdj = 0.02e18; // ±2% hard cap
        // extreme skew (~+1): raw k*skew (~0.0999) far exceeds the cap, so the multiplier clamps to 1 + maxAdj
        ISwapVM.Order memory skewOrder = _shipSkew(0.1e18, maxAdj, 1e18, 1_000_000e18);
        ISwapVM.Order memory xycOrder = _shipXyc(1e18, 1_000_000e18);

        uint256 amountIn = 1e15;
        uint256 skewOut = _quoteOutAtoB(skewOrder, amountIn);
        uint256 xycOut = _quoteOutAtoB(xycOrder, amountIn);

        assertEq(skewOut, Math.mulDiv(xycOut, SKEW_ONE + maxAdj, SKEW_ONE), "adjustment must clamp to +maxAdjustment");
    }

    function test_skew_monotone_in_imbalance() public {
        // effective multiplier = skewOut / xycOut. It must grow with |skew| (until the cap).
        ISwapVM.Order memory mild = _shipSkew(K, MAX_ADJ, 1_000e18, 1_500e18);
        ISwapVM.Order memory mildXyc = _shipXyc(1_000e18, 1_500e18);
        ISwapVM.Order memory strong = _shipSkew(K, MAX_ADJ, 1_000e18, 3_000e18);
        ISwapVM.Order memory strongXyc = _shipXyc(1_000e18, 3_000e18);

        uint256 amountIn = 1e18;
        uint256 mildFactor = Math.mulDiv(_quoteOutAtoB(mild, amountIn), SKEW_ONE, _quoteOutAtoB(mildXyc, amountIn));
        uint256 strongFactor = Math.mulDiv(_quoteOutAtoB(strong, amountIn), SKEW_ONE, _quoteOutAtoB(strongXyc, amountIn));

        assertGt(strongFactor, mildFactor, "larger imbalance must yield a larger price adjustment");
    }

    function test_reverts_before_swap() public {
        // SkewPricer placed BEFORE the swap instruction: amountOut is still 0, so it must revert.
        Program memory p = ProgramBuilder.init(_opcodes());
        bytes memory program = bytes.concat(
            p.build(SkewPricer._skewPricer, SkewPricerArgsBuilder.build(K, MAX_ADJ)),
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(vm.randomUint()))
        );
        ISwapVM.Order memory order = createStrategy(program);
        shipStrategy(order, tokenA, tokenB, 1_000e18, 2_000e18);

        SwapProgram memory sp = SwapProgram({
            amount: 10e18,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: true
        });

        vm.expectRevert(SkewPricer.SkewPricerShouldBeAppliedAfterSwap.selector);
        this.quote(sp, order);
    }

    function test_reverts_max_adjustment_ge_one() public {
        vm.expectRevert(
            abi.encodeWithSelector(SkewPricerArgsBuilder.SkewPricerMaxAdjustmentShouldBeLessThanOneE18.selector, uint64(1e18))
        );
        this.buildSkewArgs(0.1e18, 1e18);
    }

    function test_reverts_missing_k_arg() public {
        vm.expectRevert(SkewPricerArgsBuilder.SkewPricerMissingKArg.selector);
        this.parseSkewArgs("");
    }

    function test_reverts_missing_max_adjustment_arg() public {
        vm.expectRevert(SkewPricerArgsBuilder.SkewPricerMissingMaxAdjArg.selector);
        this.parseSkewArgs(abi.encodePacked(uint64(0.1e18))); // only k, maxAdjustment slice is out of range
    }

    // external boundaries so vm.expectRevert can observe library-internal reverts
    function buildSkewArgs(uint64 k, uint64 maxAdj) external pure returns (bytes memory) {
        return SkewPricerArgsBuilder.build(k, maxAdj);
    }

    function parseSkewArgs(bytes calldata args) external pure returns (uint64, uint64) {
        return SkewPricerArgsBuilder.parse(args);
    }
}
