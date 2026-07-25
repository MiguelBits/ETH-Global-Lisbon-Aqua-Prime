// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Test } from "forge-std/Test.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { ISwapVM } from "../src/SwapVM.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { Controls } from "../src/instructions/Controls.sol";
import {
    SkewPricer,
    SkewPricerValueArgsBuilder,
    SKEW_ONE
} from "../src/instructions/SkewPricer.sol";
import { Program, ProgramBuilder } from "./utils/ProgramBuilder.sol";
import { MockChainlinkAggregator } from "./mocks/MockChainlinkAggregator.sol";

import { AquaSwapVMTest } from "./base/AquaSwapVMTest.sol";

/// @title SkewPricerValue — USD-normalized skew for mixed-decimal pairs
contract SkewPricerValueTest is AquaSwapVMTest {
    using ProgramBuilder for Program;

    uint64 internal constant K = 0.5e18;
    uint64 internal constant MAX_ADJ = 0.5e18;
    int256 internal constant ETH_USD = 3000e18;

    MockChainlinkAggregator internal oracle;

    function setUp() public override {
        super.setUp();
        oracle = new MockChainlinkAggregator(18, ETH_USD);
    }

    function _valueSkewProgram(uint64 k, uint64 maxAdj) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.build(k, maxAdj, 18, 18, 18, 0, address(tokenA), address(oracle))
            ),
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

    function _quoteOut(ISwapVM.Order memory order, uint256 amountIn) internal view returns (uint256) {
        SwapProgram memory sp = SwapProgram({
            amount: amountIn,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: true
        });
        (, uint256 out) = quote(sp, order);
        return out;
    }

    /// tokenA = 18 dec (WETH stand-in), tokenB = 6 dec (USDC stand-in)
    function test_value_skew_balanced_noop() public {
        uint256 wethBal = 10e18;
        uint256 usdcBal = 30_000e18; // USD-balanced vs 10 WETH @ $3k (program quoteDecimals = 18)
        ISwapVM.Order memory skewOrder = createStrategy(_valueSkewProgram(K, MAX_ADJ));
        shipStrategy(skewOrder, tokenA, tokenB, wethBal, usdcBal);
        ISwapVM.Order memory xycOrder = createStrategy(_xycProgram());
        shipStrategy(xycOrder, tokenA, tokenB, wethBal, usdcBal);

        assertEq(_quoteOut(skewOrder, 1e18), _quoteOut(xycOrder, 1e18), "balanced USD book is no-op");
    }

    /// @notice Book heavy in the OUT-token (USDC): selling WETH heals it, so the taker gets MORE USDC.
    /// @dev Mirrors the Sepolia deploy (USDC-heavy book + default sell-WETH action) — the SkewPricer branch
    ///      diverges above XYC and wins routing.
    function test_value_skew_quote_heavy_sell_base_gives_more() public {
        uint256 wethBal = 5e18;       // ~$15k @ $3k
        uint256 usdcBal = 30_000e18;  // $30k (18-dec test units; program uses 18/18/18)
        ISwapVM.Order memory skewOrder = createStrategy(_valueSkewProgram(K, MAX_ADJ));
        shipStrategy(skewOrder, tokenA, tokenB, wethBal, usdcBal);
        ISwapVM.Order memory xycOrder = createStrategy(_xycProgram());
        shipStrategy(xycOrder, tokenA, tokenB, wethBal, usdcBal);

        uint256 skewOut = _quoteOut(skewOrder, 1e18);
        uint256 xycOut = _quoteOut(xycOrder, 1e18);
        assertGt(skewOut, xycOut, "USDC-heavy book: selling WETH heals -> taker gets more USDC");
    }

    /// @notice Book scarce in the OUT-token (USDC): protect the thin side, so the taker gets LESS USDC.
    function test_value_skew_quote_scarce_sell_base_gives_less() public {
        uint256 wethBal = 20e18;      // ~$60k @ $3k
        uint256 usdcBal = 10_000e18;  // $10k
        ISwapVM.Order memory skewOrder = createStrategy(_valueSkewProgram(K, MAX_ADJ));
        shipStrategy(skewOrder, tokenA, tokenB, wethBal, usdcBal);
        ISwapVM.Order memory xycOrder = createStrategy(_xycProgram());
        shipStrategy(xycOrder, tokenA, tokenB, wethBal, usdcBal);

        uint256 skewOut = _quoteOut(skewOrder, 1e18);
        uint256 xycOut = _quoteOut(xycOrder, 1e18);
        assertLt(skewOut, xycOut, "USDC-scarce book: protect thin side -> taker gets less USDC");
    }

    function test_value_skew_quote_matches_swap() public {
        ISwapVM.Order memory order = createStrategy(_valueSkewProgram(K, MAX_ADJ));
        shipStrategy(order, tokenA, tokenB, 15e18, 20_000e6);

        SwapProgram memory sp = SwapProgram({
            amount: 1e18,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: true
        });
        mintTokenInToTaker(sp, 1e18);
        mintTokenOutToMaker(sp, 20_000e6);

        (uint256 qIn, uint256 qOut) = quote(sp, order);
        (uint256 sIn, uint256 sOut) = swap(sp, order);
        assertEq(sIn, qIn);
        assertEq(sOut, qOut);
    }
}
