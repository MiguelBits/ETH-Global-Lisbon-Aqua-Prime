// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { console2 } from "forge-std/Test.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ISwapVM } from "../src/SwapVM.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { Controls } from "../src/instructions/Controls.sol";
import { Extruction } from "../src/instructions/Extruction.sol";
import { SkewPricer, SkewPricerValueArgsBuilder } from "../src/instructions/SkewPricer.sol";
import { Program, ProgramBuilder } from "./utils/ProgramBuilder.sol";
import { PrimeSelector } from "../src/apps/PrimeSelector.sol";
import { MockChainlinkAggregator } from "./mocks/MockChainlinkAggregator.sol";
import { PrimeFaucetToken } from "../src/mocks/PrimeFaucetToken.sol";
import { AquaSwapVMTest } from "./base/AquaSwapVMTest.sol";

/// @title AquaPrimeMiddleGround - Chainlink-bounded inventory skew ("common middle ground")
/// @notice Proves the bounded value-skew keeps the inventory heal but (a) never lets the taker
///         extract USD value above Chainlink fair value (LP is never worse off than the mark),
///         and (b) still hands better-than-XYC quotes when the pool is cheap - bounded at fair,
///         so no "pool $3k / CL $2k / skew quotes $3.5k" free money.
/// @dev Run with: forge test --match-contract AquaPrimeMiddleGround -vv
contract AquaPrimeMiddleGroundTest is AquaSwapVMTest {
    using ProgramBuilder for Program;

    // WETH/USDC config, Chainlink ETH/USD @ $1750 (8 decimals like mainnet feed).
    uint8 internal constant WETH_DEC = 18;
    uint8 internal constant USDC_DEC = 6;
    uint8 internal constant ORACLE_DEC = 8;
    int256 internal constant CL_ANSWER = 1750e8;
    uint256 internal constant CL_1E18 = 1750e18;

    uint64 internal constant SKEW_K = 0.5e18;
    uint64 internal constant SKEW_MAX = 0.1e18;
    uint64 internal constant PREMIUM_STRICT = 0; // LP never pays above / sells below fair
    uint64 internal constant PREMIUM_BAND = 0.005e18; // 0.5% tolerance to attract flow

    uint128 internal constant LAMBDA = 1e9;

    PrimeSelector internal selector;
    PrimeFaucetToken internal weth;
    PrimeFaucetToken internal usdc;
    MockChainlinkAggregator internal oracle;

    /// @dev Bumped per shipped book so repeated identical branches get unique strategy hashes.
    uint256 private _nonce;

    function setUp() public override {
        super.setUp();
        selector = new PrimeSelector(address(aqua));
        weth = new PrimeFaucetToken("Prime WETH", "pWETH", 18, 5 ether);
        usdc = new PrimeFaucetToken("Prime USDC", "pUSDC", 6, 20_000e6);
        oracle = new MockChainlinkAggregator(ORACLE_DEC, CL_ANSWER);
    }

    // ------------------------------------------------------------------
    // Branch builders
    // ------------------------------------------------------------------
    function _branchXyc() internal pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return p.build(XYCSwap._xycSwapXD);
    }

    function _branchSkewUnbounded() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.build(SKEW_K, SKEW_MAX, WETH_DEC, USDC_DEC, ORACLE_DEC, 0, address(weth), address(oracle))
            )
        );
    }

    function _branchSkewBounded(uint64 k, uint64 premium) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.buildBounded(
                    k, SKEW_MAX, WETH_DEC, USDC_DEC, ORACLE_DEC, 0, address(weth), address(oracle), premium
                )
            )
        );
    }

    // ------------------------------------------------------------------
    // USD valuation at Chainlink fair value (mirrors SkewPricer._tokenToUsd1e18)
    // ------------------------------------------------------------------
    function _usd(uint256 amount, bool isWeth) internal pure returns (uint256) {
        if (isWeth) {
            return Math.mulDiv(amount, CL_1E18, 10 ** uint256(WETH_DEC));
        }
        return Math.mulDiv(amount, 1e18, 10 ** uint256(USDC_DEC));
    }

    // ------------------------------------------------------------------
    // Book shipping + quoting helpers
    // ------------------------------------------------------------------
    function _standalone(bytes memory branch, uint256 salt) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(branch, p.build(Controls._salt, abi.encodePacked(salt)));
    }

    function _shipBook(ISwapVM.Order memory order, uint256 balWeth, uint256 balUsdc) internal {
        weth.mint(maker, balWeth);
        usdc.mint(maker, balUsdc);
        vm.startPrank(maker);
        IERC20(address(weth)).approve(address(aqua), type(uint256).max);
        IERC20(address(usdc)).approve(address(aqua), type(uint256).max);
        address[] memory tokens = new address[](2);
        tokens[0] = address(weth);
        tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = balWeth;
        amounts[1] = balUsdc;
        aqua.ship(address(swapVM), abi.encode(order), tokens, amounts);
        vm.stopPrank();
    }

    function _quoteOut(ISwapVM.Order memory order, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        view
        returns (uint256 amountOut)
    {
        (, amountOut,) = swapVM.asView().quote(order, tokenIn, tokenOut, amountIn, takerData(address(taker), true));
    }

    /// @dev Ship a fresh book for `branch` and quote a single exact-in sell.
    function _quoteBranch(bytes memory branch, uint256 balWeth, uint256 balUsdc, bool sellWeth, uint256 amountIn)
        internal
        returns (uint256)
    {
        ISwapVM.Order memory order = createStrategy(_standalone(branch, ++_nonce));
        _shipBook(order, balWeth, balUsdc);
        (address tokenIn, address tokenOut) =
            sellWeth ? (address(weth), address(usdc)) : (address(usdc), address(weth));
        return _quoteOut(order, tokenIn, tokenOut, amountIn);
    }

    // ==================================================================
    // 1. Rich pool: bounded skew kills the free money, LP protected to fair
    // ==================================================================
    function test_bounded_skew_kills_free_money_when_pool_rich() public {
        // Pool marked ~$5000/WETH by XYC while Chainlink says $1750 -> XYC alone already overpays.
        uint256 balWeth = 5 ether;
        uint256 balUsdc = 30_000e6;
        uint256 sell = 1 ether;

        uint256 xycOut = _quoteBranch(_branchXyc(), balWeth, balUsdc, true, sell);
        uint256 unboundedOut = _quoteBranch(_branchSkewUnbounded(), balWeth, balUsdc, true, sell);
        uint256 boundedOut = _quoteBranch(_branchSkewBounded(SKEW_K, PREMIUM_STRICT), balWeth, balUsdc, true, sell);

        uint256 usdIn = _usd(sell, true); // 1 WETH @ CL = $1750
        console2.log("");
        console2.log("=== RICH POOL (XYC implies ~$5000, CL $1750) - sell 1 WETH ===");
        console2.log("usd value IN (1 WETH @ CL):", usdIn);
        console2.log("XYC out (USDC):           ", xycOut);
        console2.log("  -> USD paid to taker:   ", _usd(xycOut, false));
        console2.log("UNBOUNDED skew out (USDC):", unboundedOut);
        console2.log("  -> USD paid to taker:   ", _usd(unboundedOut, false));
        console2.log("BOUNDED skew out (USDC):  ", boundedOut);
        console2.log("  -> USD paid to taker:   ", _usd(boundedOut, false));

        // Unbounded skew makes the free money worse; XYC alone already overpays.
        assertGt(unboundedOut, xycOut, "unbounded skew pays even more than XYC when rich");
        assertGt(xycOut, boundedOut, "bounded skew pays far less than naked XYC");

        // Core LP protection: taker never receives more USD value than they put in.
        assertLe(_usd(boundedOut, false), usdIn, "bounded skew: LP never worse than Chainlink fair");
        // And it lands right at fair (the cap binds), not below.
        assertApproxEqRel(_usd(boundedOut, false), usdIn, 1e12, "bounded skew clamps to fair value");

        // Quantify the LP rescue vs XYC's own overpay.
        int256 lpRescueUsd = int256(_usd(xycOut, false)) - int256(_usd(boundedOut, false));
        console2.log("LP value rescued vs XYC (USD 1e18):", lpRescueUsd);
        assertGt(lpRescueUsd, 0, "bounded skew protects LP relative to naked XYC");
    }

    // ==================================================================
    // 2. Cheap pool: bounded skew gives a BETTER quote than XYC, capped at fair
    // ==================================================================
    function test_bounded_skew_better_quote_but_bounded_when_cheap() public {
        // USDC slightly overstocked (skew bonus applies) yet XYC implies < CL (pool cheap).
        uint256 balWeth = 5 ether;
        uint256 balUsdc = 10_000e6; // XYC implies ~$1667 < $1750
        uint256 sell = 1 ether;

        uint256 xycOut = _quoteBranch(_branchXyc(), balWeth, balUsdc, true, sell);
        uint256 boundedOut = _quoteBranch(_branchSkewBounded(SKEW_K, PREMIUM_STRICT), balWeth, balUsdc, true, sell);

        uint256 usdIn = _usd(sell, true);
        console2.log("");
        console2.log("=== CHEAP POOL (XYC implies ~$1667, CL $1750) - sell 1 WETH ===");
        console2.log("usd value IN (1 WETH @ CL):", usdIn);
        console2.log("XYC out (USDC):         ", xycOut);
        console2.log("BOUNDED skew out (USDC):", boundedOut);
        console2.log("taker bonus bps vs XYC: ", int256(Math.mulDiv(boundedOut, 10_000, xycOut)) - 10_000);
        console2.log("USD paid to taker:      ", _usd(boundedOut, false));

        // Better quote than XYC for the taker...
        assertGt(boundedOut, xycOut, "bounded skew improves taker quote when pool cheap");
        // ...but never above fair value (no huge payout, LP stays whole vs mark).
        assertLe(_usd(boundedOut, false), usdIn, "bounded skew never pays above fair value");
    }

    // ==================================================================
    // 3. LP never worse than fair - invariant across a scenario matrix
    // ==================================================================
    function test_bounded_skew_lp_never_worse_than_fair_matrix() public {
        console2.log("");
        console2.log("=== LP-PROTECTION INVARIANT MATRIX (premium = 0) ===");
        // (balWeth, balUsdc, sellWeth, amountIn)
        _assertNoLpLoss(5 ether, 30_000e6, true, 1 ether, "rich, sell WETH");
        _assertNoLpLoss(5 ether, 10_000e6, true, 1 ether, "cheap, sell WETH");
        _assertNoLpLoss(5 ether, 8_750e6, true, 0.5 ether, "balanced, sell WETH");
        _assertNoLpLoss(10 ether, 5_000e6, false, 3_000e6, "WETH-heavy, buy WETH");
        _assertNoLpLoss(2 ether, 20_000e6, false, 1_000e6, "USDC-heavy, buy WETH");
        _assertNoLpLoss(1 ether, 1_000e6, true, 0.2 ether, "tiny book, sell WETH");
    }

    function _assertNoLpLoss(uint256 balWeth, uint256 balUsdc, bool sellWeth, uint256 amountIn, string memory label)
        internal
    {
        uint256 out = _quoteBranch(_branchSkewBounded(SKEW_K, PREMIUM_STRICT), balWeth, balUsdc, sellWeth, amountIn);
        uint256 usdIn = _usd(amountIn, sellWeth);
        uint256 usdOut = _usd(out, !sellWeth);
        console2.log(label);
        console2.log("  usdIn :", usdIn);
        console2.log("  usdOut:", usdOut);
        // Allow 1 wei-scale rounding slack (cap rounds LP-favorable, so usdOut should be <= usdIn).
        assertLe(usdOut, usdIn + 1e6, "bounded skew: taker never extracts USD value above fair");
    }

    // ==================================================================
    // 4. Scarce-side protection preserved (cap must not loosen the heal)
    // ==================================================================
    function test_bounded_skew_scarce_side_still_protects() public {
        // Selling WETH into a WETH-heavy book: USDC (out) is scarce -> skew must pay LESS, not more.
        uint256 balWeth = 20 ether;
        uint256 balUsdc = 5_000e6;
        uint256 sell = 1 ether;

        uint256 xycOut = _quoteBranch(_branchXyc(), balWeth, balUsdc, true, sell);
        uint256 boundedOut = _quoteBranch(_branchSkewBounded(SKEW_K, PREMIUM_STRICT), balWeth, balUsdc, true, sell);

        console2.log("");
        console2.log("=== SCARCE OUT-TOKEN - sell 1 WETH into WETH-heavy book ===");
        console2.log("XYC out (USDC):         ", xycOut);
        console2.log("BOUNDED skew out (USDC):", boundedOut);

        assertLe(boundedOut, xycOut, "bounded skew still protects the scarce side (pays no more than XYC)");
    }

    // ==================================================================
    // 5. Determinism: quote == swap for the bounded branch
    // ==================================================================
    function test_bounded_skew_quote_equals_swap() public {
        uint256 balWeth = 5 ether;
        uint256 balUsdc = 30_000e6;
        uint256 sell = 1 ether;

        ISwapVM.Order memory order = createStrategy(_standalone(_branchSkewBounded(SKEW_K, PREMIUM_STRICT), 7));
        _shipBook(order, balWeth, balUsdc);

        uint256 quoted = _quoteOut(order, address(weth), address(usdc), sell);

        weth.mint(address(taker), sell);
        (, uint256 executedOut) =
            taker.swap(order, address(weth), address(usdc), sell, takerData(address(taker), true));

        console2.log("");
        console2.log("=== QUOTE == SWAP (bounded) ===");
        console2.log("quoted out:  ", quoted);
        console2.log("executed out:", executedOut);
        assertEq(quoted, executedOut, "bounded skew is deterministic: quote must equal swap");
    }

    // ==================================================================
    // 6. Routing: an all-bounded desk never overpays; a legacy desk does
    // ==================================================================
    function _selectorArgs2(uint128 lambda, bytes memory a, bytes memory b) internal pure returns (bytes memory) {
        return abi.encodePacked(lambda, uint8(2), uint16(a.length), a, uint16(b.length), b);
    }

    function _primeProgram2(uint128 lambda, bytes memory a, bytes memory b, uint256 salt)
        internal
        view
        returns (bytes memory)
    {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(Extruction._extruction, abi.encodePacked(address(selector), _selectorArgs2(lambda, a, b))),
            p.build(Controls._salt, abi.encodePacked(salt))
        );
    }

    function _quotePrime(bytes memory program, uint256 balWeth, uint256 balUsdc, uint256 sell)
        internal
        returns (uint256)
    {
        ISwapVM.Order memory order = createStrategy(program);
        _shipBook(order, balWeth, balUsdc);
        return _quoteOut(order, address(weth), address(usdc), sell);
    }

    function test_prime_all_bounded_desk_never_overpays_vs_legacy() public {
        uint256 balWeth = 5 ether;
        uint256 balUsdc = 30_000e6; // rich vs CL -> the danger zone
        uint256 sell = 1 ether;
        uint256 usdIn = _usd(sell, true);

        // Legacy desk: naked XYC + unbounded skew -> free money survives.
        bytes memory legacy = _primeProgram2(
            LAMBDA, _branchXyc(), _branchSkewUnbounded(), 21
        );
        // Middle-ground desk: every branch fair-bounded (XYC baseline via k=0 + inventory heal).
        bytes memory middle = _primeProgram2(
            LAMBDA,
            _branchSkewBounded(0, PREMIUM_STRICT),
            _branchSkewBounded(SKEW_K, PREMIUM_STRICT),
            22
        );

        uint256 legacyOut = _quotePrime(legacy, balWeth, balUsdc, sell);
        uint256 middleOut = _quotePrime(middle, balWeth, balUsdc, sell);

        console2.log("");
        console2.log("=== DESK COMPARISON on rich book (CL $1750) - sell 1 WETH ===");
        console2.log("usd value IN:            ", usdIn);
        console2.log("LEGACY desk out (USDC):  ", legacyOut);
        console2.log("  -> USD paid to taker:  ", _usd(legacyOut, false));
        console2.log("MIDDLE desk out (USDC):  ", middleOut);
        console2.log("  -> USD paid to taker:  ", _usd(middleOut, false));

        // Legacy overpays the taker vs fair (LP bleeds); middle ground is capped at fair.
        assertGt(_usd(legacyOut, false), usdIn, "legacy desk overpays vs Chainlink (free money)");
        assertLe(_usd(middleOut, false), usdIn, "middle-ground desk never overpays vs Chainlink");
        assertGt(legacyOut, middleOut, "middle ground routes a cheaper (LP-safe) quote");
    }
}
