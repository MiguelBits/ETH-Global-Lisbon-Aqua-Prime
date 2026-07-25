// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { ISwapVM } from "../src/SwapVM.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { Controls } from "../src/instructions/Controls.sol";
import { Extruction } from "../src/instructions/Extruction.sol";
import { SkewPricer, SkewPricerArgsBuilder } from "../src/instructions/SkewPricer.sol";
import { OraclePriceAdjuster, OraclePriceAdjusterArgsBuilder } from "../src/instructions/OraclePriceAdjuster.sol";
import { Decay, DecayArgsBuilder } from "../src/instructions/Decay.sol";
import { Program, ProgramBuilder } from "./utils/ProgramBuilder.sol";

import { AquaSwapVMTest } from "./base/AquaSwapVMTest.sol";
import { PrimeSelector } from "../src/apps/PrimeSelector.sol";
import { MockChainlinkAggregator } from "./mocks/MockChainlinkAggregator.sol";

/// @title Aqua Prime — mock end-to-end
/// @notice Ship a standalone `_xycSwapXD -> _skewPricer -> _salt` program on virtual Aqua balances, then
///         prove settlement moves both the taker ERC20 balances and the maker virtual balances, and that
///         quote() == swap() for both exact-in and exact-out.
contract AquaPrimeTest is AquaSwapVMTest {
    using ProgramBuilder for Program;

    uint64 internal constant K = 0.3e18;
    uint64 internal constant MAX_ADJ = 0.1e18;
    uint16 internal constant DECAY_PERIOD = 300;

    uint256 internal constant BAL_A = 1_000e18;
    uint256 internal constant BAL_B = 3_000e18; // out-token (B) overstocked for A->B: skew is active

    PrimeSelector internal selector;

    function setUp() public override {
        super.setUp();
        selector = new PrimeSelector(address(aqua));
    }

    function _skewProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(SkewPricer._skewPricer, SkewPricerArgsBuilder.build(K, MAX_ADJ)),
            p.build(Controls._salt, abi.encodePacked(vm.randomUint()))
        );
    }

    function _shipSkew() internal returns (ISwapVM.Order memory order, bytes32 hash) {
        order = createStrategy(_skewProgram());
        hash = shipStrategy(order, tokenA, tokenB, BAL_A, BAL_B);
    }

    function test_ship_and_swap_standalone_skew_program() public {
        (ISwapVM.Order memory order, bytes32 hash) = _shipSkew();

        uint256 amountIn = 100e18;
        SwapProgram memory sp = SwapProgram({
            amount: amountIn,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true, // A -> B
            isExactIn: true
        });
        mintTokenInToTaker(sp, amountIn); // taker holds tokenA to push
        mintTokenOutToMaker(sp, BAL_B); // maker holds tokenB to pull

        (uint256 takerABefore, uint256 takerBBefore) = getTakerBalances(taker);
        (uint256 vAbefore, uint256 vBbefore) = getAquaBalances(hash);

        (uint256 amtIn, uint256 amtOut) = swap(sp, order);

        assertEq(amtIn, amountIn, "exact-in amountIn unchanged");
        assertGt(amtOut, 0, "amountOut must be positive");

        // taker: -tokenA (in), +tokenB (out)
        (uint256 takerAAfter, uint256 takerBAfter) = getTakerBalances(taker);
        assertEq(takerABefore - takerAAfter, amtIn, "taker pays tokenA in");
        assertEq(takerBAfter - takerBBefore, amtOut, "taker receives tokenB out");

        // maker virtual balances: +tokenA (in), -tokenB (out)
        (uint256 vAafter, uint256 vBafter) = getAquaBalances(hash);
        assertEq(vAafter - vAbefore, amtIn, "virtual tokenA increases by amountIn");
        assertEq(vBbefore - vBafter, amtOut, "virtual tokenB decreases by amountOut");
    }

    function test_virtual_balances_settle_correctly_reverse_direction() public {
        (ISwapVM.Order memory order, bytes32 hash) = _shipSkew();

        // B -> A: now tokenIn is B, tokenOut is A. balanceIn = B (3000), balanceOut = A (1000): out-token scarce.
        uint256 amountIn = 200e18;
        SwapProgram memory sp = SwapProgram({
            amount: amountIn,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: false, // B -> A
            isExactIn: true
        });
        mintTokenInToTaker(sp, amountIn); // taker holds tokenB to push
        mintTokenOutToMaker(sp, BAL_A); // maker holds tokenA to pull

        (uint256 vAbefore, uint256 vBbefore) = getAquaBalances(hash);
        (uint256 amtIn, uint256 amtOut) = swap(sp, order);

        (uint256 vAafter, uint256 vBafter) = getAquaBalances(hash);
        // in-token is B (virtual B up), out-token is A (virtual A down)
        assertEq(vBafter - vBbefore, amtIn, "virtual tokenB increases by amountIn");
        assertEq(vAbefore - vAafter, amtOut, "virtual tokenA decreases by amountOut");
    }

    function test_quote_matches_swap_skew_exact_in() public {
        (ISwapVM.Order memory order, ) = _shipSkew();

        SwapProgram memory sp = SwapProgram({
            amount: 50e18,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: true
        });
        mintTokenInToTaker(sp, 50e18);
        mintTokenOutToMaker(sp, BAL_B);

        (uint256 qIn, uint256 qOut) = quote(sp, order);
        (uint256 sIn, uint256 sOut) = swap(sp, order);

        assertEq(sIn, qIn, "exact-in: amountIn quote==swap");
        assertEq(sOut, qOut, "exact-in: amountOut quote==swap");
    }

    function test_quote_matches_swap_skew_exact_out() public {
        (ISwapVM.Order memory order, ) = _shipSkew();

        uint256 amountOut = 60e18; // desired tokenB out
        SwapProgram memory sp = SwapProgram({
            amount: amountOut,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true, // A -> B
            isExactIn: false
        });
        mintTokenInToTaker(sp, BAL_A); // taker holds plenty tokenA to cover computed amountIn
        mintTokenOutToMaker(sp, BAL_B);

        (uint256 qIn, uint256 qOut) = quote(sp, order);
        (uint256 sIn, uint256 sOut) = swap(sp, order);

        assertEq(sOut, qOut, "exact-out: amountOut quote==swap");
        assertEq(sIn, qIn, "exact-out: amountIn quote==swap");
        assertEq(sOut, amountOut, "exact-out delivers the requested output");
    }

    // ===================== Phase 2: PrimeSelector maker-side routing =====================

    // branch programs (no trailing salt: uniqueness comes from the enclosing prime program's salt)
    function _branchXyc() internal pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return p.build(XYCSwap._xycSwapXD);
    }

    function _branchClamp(address oracle) internal pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            // maxPriceDecay 0.95e18 => bidirectional ±5% clamp toward Chainlink
            p.build(OraclePriceAdjuster._oraclePriceAdjuster1D, OraclePriceAdjusterArgsBuilder.build(0.95e18, 0, 18, oracle))
        );
    }

    function _branchSkew(uint64 k, uint64 maxAdj) internal pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(SkewPricer._skewPricer, SkewPricerArgsBuilder.build(k, maxAdj))
        );
    }

    // full Aqua Prime program: decay → extruction(PrimeSelector) → salt
    function _primeProgram(uint128 lambda, uint64 k, uint64 maxAdj, address oracle) internal view returns (bytes memory) {
        bytes memory a = _branchXyc();
        bytes memory b = _branchClamp(oracle);
        bytes memory c = _branchSkew(k, maxAdj);
        bytes memory selectorArgs = abi.encodePacked(
            address(selector),
            lambda,
            uint8(3),
            uint16(a.length), a,
            uint16(b.length), b,
            uint16(c.length), c
        );
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(Decay._decayXD, DecayArgsBuilder.build(DECAY_PERIOD)),
            p.build(Extruction._extruction, selectorArgs),
            p.build(Controls._salt, abi.encodePacked(vm.randomUint()))
        );
    }

    function _standalone(bytes memory branch) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(branch, p.build(Controls._salt, abi.encodePacked(vm.randomUint())));
    }

    function _shipAndQuoteAtoB(bytes memory program, uint256 balA, uint256 balB, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        ISwapVM.Order memory order = createStrategy(program);
        shipStrategy(order, tokenA, tokenB, balA, balB);
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

    function test_selector_picks_xyc_when_balanced() public {
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 0.1e18); // below pool price => no boost
        uint256 amountIn = 10e18;
        uint256 primeOut = _shipAndQuoteAtoB(_primeProgram(1e15, 0.5e18, 0.5e18, address(oracle)), 1_000e18, 1_000e18, amountIn);
        uint256 xycOut = _shipAndQuoteAtoB(_standalone(_branchXyc()), 1_000e18, 1_000e18, amountIn);

        // balanced book: skew is a no-op; clamp worsens vs XYC when oracle below pool => XYC wins
        assertEq(primeOut, xycOut, "balanced book must route through plain XYC");
    }

    function test_selector_picks_skew_when_lopsided() public {
        // THE THESIS TEST: scarce out-token. Skew charges MORE (lower taker output than XYC) but heals the
        // book, so with a high inventory weight the maker-side score picks skew over the higher-output XYC.
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 0.05e18); // no drift
        uint256 amountIn = 50e18;
        uint128 lambda = 1e24; // heavy inventory penalty

        uint256 primeOut = _shipAndQuoteAtoB(_primeProgram(lambda, 0.5e18, 0.5e18, address(oracle)), 3_000e18, 1_000e18, amountIn);
        uint256 xycOut = _shipAndQuoteAtoB(_standalone(_branchXyc()), 3_000e18, 1_000e18, amountIn);
        uint256 skewOut = _shipAndQuoteAtoB(_standalone(_branchSkew(0.5e18, 0.5e18)), 3_000e18, 1_000e18, amountIn);

        assertLt(skewOut, xycOut, "sanity: skew gives the taker LESS on a scarce out-token");
        assertEq(primeOut, skewOut, "maker-side routing must pick the inventory-healing skew branch");
    }

    function test_clamp_reduces_output_when_pool_rich() public {
        // Standalone clamp: pool rich vs Chainlink pulls the quote down toward the feed.
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 0.05e18);
        uint256 amountIn = 10e18;

        uint256 xycOut = _shipAndQuoteAtoB(_standalone(_branchXyc()), 1_000e18, 1_000e18, amountIn);
        uint256 clampOut = _shipAndQuoteAtoB(_standalone(_branchClamp(address(oracle))), 1_000e18, 1_000e18, amountIn);

        assertLt(clampOut, xycOut, "rich pool: clamp pulls quote toward Chainlink");
    }

    function test_selector_picks_clamp_when_pool_cheap() public {
        // Balanced book, oracle above pool price, near-zero inventory weight => clamp branch wins.
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 2e18);
        uint256 amountIn = 10e18;

        uint256 primeOut = _shipAndQuoteAtoB(_primeProgram(0, 0.5e18, 0.02e18, address(oracle)), 1_000e18, 1_000e18, amountIn);
        uint256 xycOut = _shipAndQuoteAtoB(_standalone(_branchXyc()), 1_000e18, 1_000e18, amountIn);
        uint256 clampOut = _shipAndQuoteAtoB(_standalone(_branchClamp(address(oracle))), 1_000e18, 1_000e18, amountIn);

        assertGt(clampOut, xycOut, "sanity: cheap pool clamp improves taker output toward oracle");
        assertEq(primeOut, clampOut, "routing must pick the reference-clamp branch when pool is cheap vs Chainlink");
    }

    function test_selector_deterministic_quote_vs_swap() public {
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 0.05e18);
        bytes memory program = _primeProgram(1e24, 0.5e18, 0.5e18, address(oracle));
        ISwapVM.Order memory order = createStrategy(program);
        shipStrategy(order, tokenA, tokenB, 3_000e18, 1_000e18);

        uint256 amountIn = 50e18;
        SwapProgram memory sp = SwapProgram({
            amount: amountIn,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: true
        });
        mintTokenInToTaker(sp, amountIn);
        mintTokenOutToMaker(sp, 1_000e18);

        (uint256 qIn, uint256 qOut) = quote(sp, order);
        (uint256 sIn, uint256 sOut) = swap(sp, order);

        assertEq(sIn, qIn, "selector amountIn quote==swap");
        assertEq(sOut, qOut, "selector amountOut quote==swap");
    }
}
