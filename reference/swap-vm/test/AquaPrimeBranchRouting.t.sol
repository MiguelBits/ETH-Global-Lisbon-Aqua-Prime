// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Test, console2 } from "forge-std/Test.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

import { ISwapVM } from "../src/SwapVM.sol";
import { SwapQuery, SwapRegisters } from "../src/libs/VM.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { Controls } from "../src/instructions/Controls.sol";
import { Extruction } from "../src/instructions/Extruction.sol";
import {
    SkewPricer,
    SkewPricerArgsBuilder,
    SkewPricerValueArgsBuilder
} from "../src/instructions/SkewPricer.sol";
import { OraclePriceAdjuster, OraclePriceAdjusterArgsBuilder } from "../src/instructions/OraclePriceAdjuster.sol";
import { Program, ProgramBuilder } from "./utils/ProgramBuilder.sol";
import { PrimeSelector } from "../src/apps/PrimeSelector.sol";
import { MockChainlinkAggregator } from "./mocks/MockChainlinkAggregator.sol";
import { PrimeFaucetToken } from "../src/mocks/PrimeFaucetToken.sol";
import { AquaSwapVMTest } from "./base/AquaSwapVMTest.sol";

/// @title AquaPrimeBranchRouting - branch winner matrix with logged comparative data
/// @notice Proves when XYC, clamp, and skew each win routing and quantifies taker/maker benefit.
/// @dev Run with: forge test --match-contract AquaPrimeBranchRouting -vv
contract AquaPrimeBranchRoutingTest is AquaSwapVMTest {
    using ProgramBuilder for Program;

    uint8 internal constant BRANCH_XYC = 0;
    uint8 internal constant BRANCH_CLAMP = 1;
    uint8 internal constant BRANCH_SKEW = 2;

    uint128 internal constant LAMBDA_SEPOLIA = 1e9;
    uint64 internal constant SKEW_K = 0.5e18;
    uint64 internal constant SKEW_MAX = 0.1e18;
    uint64 internal constant CLAMP_DECAY = 0.95e18;

    PrimeSelector internal selector;
    PrimeFaucetToken internal weth;
    PrimeFaucetToken internal usdc;

    struct BranchMatrix {
        uint256[3] amountOut;
        int256[3] score;
        uint256[3] postSkewE18;
        uint8 winner;
        uint256 primeOut;
    }

    function setUp() public override {
        super.setUp();
        selector = new PrimeSelector(address(aqua));
        weth = new PrimeFaucetToken("Prime WETH", "pWETH", 18, 5 ether);
        usdc = new PrimeFaucetToken("Prime USDC", "pUSDC", 6, 20_000e6);
    }

    function _branchXyc() internal pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return p.build(XYCSwap._xycSwapXD);
    }

    function _branchClamp(address oracle, uint8 oracleDecimals) internal pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(
                OraclePriceAdjuster._oraclePriceAdjuster1D,
                OraclePriceAdjusterArgsBuilder.build(CLAMP_DECAY, 0, oracleDecimals, oracle)
            )
        );
    }

    function _branchSkewRaw(uint64 k, uint64 maxAdj) internal pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(SkewPricer._skewPricer, SkewPricerArgsBuilder.build(k, maxAdj))
        );
    }

    function _branchSkewValue(address baseToken, address oracle) internal pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.build(SKEW_K, SKEW_MAX, 18, 6, 8, 0, baseToken, oracle)
            )
        );
    }

    function _selectorArgs(
        uint128 lambda,
        bytes memory branchA,
        bytes memory branchB,
        bytes memory branchC
    ) internal view returns (bytes memory) {
        return abi.encodePacked(
            lambda,
            uint8(3),
            uint16(branchA.length), branchA,
            uint16(branchB.length), branchB,
            uint16(branchC.length), branchC
        );
    }

    function _primeProgram(
        uint128 lambda,
        bytes memory branchA,
        bytes memory branchB,
        bytes memory branchC
    ) internal view returns (bytes memory) {
        bytes memory selectorArgs = _selectorArgs(lambda, branchA, branchB, branchC);
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(Extruction._extruction, abi.encodePacked(address(selector), selectorArgs)),
            p.build(Controls._salt, abi.encodePacked(uint256(42)))
        );
    }

    function _standalone(bytes memory branch) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(branch, p.build(Controls._salt, abi.encodePacked(uint256(99))));
    }

    function _simulate(
        address base,
        address quote,
        uint256 balBase,
        uint256 balQuote,
        uint128 lambda,
        bytes memory branchA,
        bytes memory branchB,
        bytes memory branchC,
        bool sellBase,
        uint256 amountIn
    ) internal returns (BranchMatrix memory m) {
        bytes memory program = _primeProgram(lambda, branchA, branchB, branchC);
        ISwapVM.Order memory order = createStrategy(program);
        _shipBook(order, base, quote, balBase, balQuote);

        (address tokenIn, address tokenOut, uint256 balIn, uint256 balOut) = sellBase
            ? (base, quote, balBase, balQuote)
            : (quote, base, balQuote, balBase);

        m.primeOut = _quoteOut(order, tokenIn, tokenOut, amountIn);

        SwapQuery memory query = SwapQuery({
            orderHash: swapVM.hash(order),
            maker: maker,
            taker: address(taker),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            isExactIn: true
        });
        SwapRegisters memory swap = SwapRegisters({
            balanceIn: balIn,
            balanceOut: balOut,
            amountIn: amountIn,
            amountOut: 0,
            amountNetPulled: 0
        });

        bytes memory selectorArgs = _selectorArgs(lambda, branchA, branchB, branchC);
        bytes memory td = takerData(address(taker), true);

        (PrimeSelector.BranchResult[] memory results, uint8 winner) =
            selector.simulateBranches(query, swap, selectorArgs, td);

        m.winner = winner;
        for (uint256 i = 0; i < 3; i++) {
            m.amountOut[i] = results[i].amountOut;
            m.score[i] = results[i].score;
            m.postSkewE18[i] = results[i].postSkewE18;
        }
    }

    function _quoteOut(
        ISwapVM.Order memory order,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (uint256 amountOut) {
        bytes memory td = takerData(address(taker), true);
        (, amountOut,) = swapVM.asView().quote(order, tokenIn, tokenOut, amountIn, td);
    }

    function _quoteStandalone(
        bytes memory branch,
        address base,
        address quote,
        uint256 balBase,
        uint256 balQuote,
        bool sellBase,
        uint256 amountIn
    ) internal returns (uint256) {
        ISwapVM.Order memory order = createStrategy(_standalone(branch));
        _shipBook(order, base, quote, balBase, balQuote);
        (address tokenIn, address tokenOut) = sellBase ? (base, quote) : (quote, base);
        return _quoteOut(order, tokenIn, tokenOut, amountIn);
    }

    function _shipBook(
        ISwapVM.Order memory order,
        address base,
        address quote,
        uint256 balBase,
        uint256 balQuote
    ) internal {
        _mintToken(maker, base, balBase);
        _mintToken(maker, quote, balQuote);
        vm.startPrank(maker);
        IERC20(base).approve(address(aqua), type(uint256).max);
        IERC20(quote).approve(address(aqua), type(uint256).max);
        bytes memory strategy = abi.encode(order);
        address[] memory tokens = new address[](2);
        tokens[0] = base;
        tokens[1] = quote;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = balBase;
        amounts[1] = balQuote;
        aqua.ship(address(swapVM), strategy, tokens, amounts);
        vm.stopPrank();
    }

    function _mintToken(address to, address token, uint256 amount) internal {
        if (token == address(weth) || token == address(usdc)) {
            PrimeFaucetToken(token).mint(to, amount);
        } else {
            TokenMock(token).mint(to, amount);
        }
    }

    function _bpsDelta(uint256 baseAmount, uint256 candidate) internal pure returns (int256) {
        if (baseAmount == 0) return 0;
        return int256(Math.mulDiv(candidate, 10_000, baseAmount)) - 10_000;
    }

    function _logMatrix(string memory title, BranchMatrix memory m, int256 chainlinkUsd1e18) internal pure {
        console2.log("");
        console2.log("=== %s ===", title);
        if (chainlinkUsd1e18 > 0) {
            console2.log("Chainlink reference (1e18 scale):", uint256(chainlinkUsd1e18));
        }
        console2.log("Branch 0 XYC   out:", m.amountOut[0]);
        console2.log("             score:", m.score[0]);
        console2.log("             postSkewE18:", m.postSkewE18[0]);
        console2.log("Branch 1 CLAMP out:", m.amountOut[1]);
        console2.log("             score:", m.score[1]);
        console2.log("             postSkewE18:", m.postSkewE18[1]);
        console2.log("Branch 2 SKEW  out:", m.amountOut[2]);
        console2.log("             score:", m.score[2]);
        console2.log("             postSkewE18:", m.postSkewE18[2]);
        console2.log("Prime routed out:", m.primeOut);
        console2.log("Winner index:", m.winner);
        console2.log("XYC vs CLAMP bps:", _bpsDelta(m.amountOut[0], m.amountOut[1]));
        console2.log("XYC vs SKEW  bps:", _bpsDelta(m.amountOut[0], m.amountOut[2]));
    }

    function test_branch_xyc_wins_balanced_fair_book() public {
        // Oracle slightly below pool implied price: clamp tightens vs XYC, so plain XYC wins on score.
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 98e16);
        bytes memory xyc = _branchXyc();
        bytes memory clamp = _branchClamp(address(oracle), 18);
        bytes memory skew = _branchSkewRaw(SKEW_K, SKEW_MAX);

        BranchMatrix memory m = _simulate(
            address(tokenA), address(tokenB),
            1_000e18, 1_000e18,
            LAMBDA_SEPOLIA,
            xyc, clamp, skew,
            true, 10e18
        );

        _logMatrix("XYC WINS - balanced fair book", m, 0);

        assertEq(m.winner, BRANCH_XYC, "balanced fair book routes XYC");
        assertEq(m.primeOut, m.amountOut[BRANCH_XYC], "prime matches XYC out");
        assertEq(m.amountOut[BRANCH_SKEW], m.amountOut[BRANCH_XYC], "skew noop when balanced");
        assertLe(m.amountOut[BRANCH_CLAMP], m.amountOut[BRANCH_XYC], "clamp not better when oracle below pool");
    }

    function test_branch_clamp_wins_pool_cheap_vs_chainlink() public {
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 2e18);
        bytes memory xyc = _branchXyc();
        bytes memory clamp = _branchClamp(address(oracle), 18);
        bytes memory skew = _branchSkewRaw(SKEW_K, SKEW_MAX);

        BranchMatrix memory m = _simulate(
            address(tokenA), address(tokenB),
            1_000e18, 1_000e18,
            0,
            xyc, clamp, skew,
            true, 10e18
        );

        _logMatrix("CLAMP WINS - pool cheap vs Chainlink", m, 2e18);

        assertGt(m.amountOut[BRANCH_CLAMP], m.amountOut[BRANCH_XYC], "clamp improves taker vs XYC");
        assertEq(m.winner, BRANCH_CLAMP, "router picks clamp branch");
        assertEq(m.primeOut, m.amountOut[BRANCH_CLAMP], "prime matches clamp out");

        int256 takerBonusBps = _bpsDelta(m.amountOut[BRANCH_XYC], m.amountOut[BRANCH_CLAMP]);
        console2.log("Taker bonus vs XYC (bps):", takerBonusBps);
        assertGt(takerBonusBps, 0, "clamp strictly better for taker when pool cheap");
    }

    function test_clamp_taker_wins_when_undershot_chainlink() public {
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 1750e18);
        uint256 xycOut = _quoteStandalone(
            _branchXyc(), address(tokenA), address(tokenB), 500e18, 500_000e18, true, 1e18
        );
        uint256 clampOut = _quoteStandalone(
            _branchClamp(address(oracle), 18), address(tokenA), address(tokenB), 500e18, 500_000e18, true, 1e18
        );

        console2.log("Undershoot scenario - sell 1 unit");
        console2.log("Chainlink ref:", uint256(1750e18));
        console2.log("XYC out:", xycOut);
        console2.log("Clamp out:", clampOut);
        console2.log("Taker bonus bps:", _bpsDelta(xycOut, clampOut));

        assertGt(clampOut, xycOut, "clamp lifts quote toward Chainlink after undershoot");
    }

    function test_clamp_maker_protected_when_rich_vs_chainlink() public {
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 1750e18);
        uint256 xycOut = _quoteStandalone(
            _branchXyc(), address(tokenA), address(tokenB), 5e18, 30_000e18, true, 1e18
        );
        uint256 clampOut = _quoteStandalone(
            _branchClamp(address(oracle), 18), address(tokenA), address(tokenB), 5e18, 30_000e18, true, 1e18
        );

        console2.log("Rich pool scenario - sell 1 unit");
        console2.log("Chainlink ref:", uint256(1750e18));
        console2.log("XYC out:", xycOut);
        console2.log("Clamp out:", clampOut);
        console2.log("Taker haircut bps:", _bpsDelta(xycOut, clampOut));

        assertLt(clampOut, xycOut, "clamp cuts rich-pool overpay toward Chainlink");
    }

    function test_branch_skew_wins_sepolia_usdc_heavy_sell_weth() public {
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(8, 1750e8);
        bytes memory xyc = _branchXyc();
        bytes memory clamp = _branchClamp(address(oracle), 8);
        bytes memory skew = _branchSkewValue(address(weth), address(oracle));

        BranchMatrix memory m = _simulate(
            address(weth), address(usdc),
            5 ether, 30_000e6,
            LAMBDA_SEPOLIA,
            xyc, clamp, skew,
            true, 1 ether
        );

        _logMatrix("SKEW WINS - Sepolia USDC-heavy sell WETH", m, 1750e18);

        assertGt(m.amountOut[BRANCH_SKEW], m.amountOut[BRANCH_XYC], "skew pays more USDC than XYC");
        assertEq(m.winner, BRANCH_SKEW, "router picks skew on imbalanced book");
        assertEq(m.primeOut, m.amountOut[BRANCH_SKEW], "prime matches skew out");

        int256 takerBonusBps = _bpsDelta(m.amountOut[BRANCH_XYC], m.amountOut[BRANCH_SKEW]);
        console2.log("Skew taker bonus vs XYC (bps):", takerBonusBps);
        assertGt(takerBonusBps, 500, "skew bonus material on Sepolia config");
    }

    function test_branch_skew_wins_scarce_out_token_maker_score() public {
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(18, 1e18);
        bytes memory xyc = _branchXyc();
        bytes memory clamp = _branchClamp(address(oracle), 18);
        bytes memory skew = _branchSkewRaw(0.5e18, 0.5e18);

        BranchMatrix memory m = _simulate(
            address(tokenA), address(tokenB),
            3_000e18, 1_000e18,
            1e24,
            xyc, clamp, skew,
            true, 50e18
        );

        _logMatrix("SKEW WINS - scarce out-token (maker score)", m, 0);

        assertLt(m.amountOut[BRANCH_SKEW], m.amountOut[BRANCH_XYC], "skew gives taker less on scarce side");
        assertGt(m.score[BRANCH_SKEW], m.score[BRANCH_XYC], "maker score still prefers skew");
        assertEq(m.winner, BRANCH_SKEW, "router picks skew for inventory heal");
        assertEq(m.primeOut, m.amountOut[BRANCH_SKEW]);
    }

    function test_healing_sequence_skew_wins_then_inventory_converges() public {
        MockChainlinkAggregator oracle = new MockChainlinkAggregator(8, 1750e8);

        bytes memory primeSkew = _primeProgram(
            LAMBDA_SEPOLIA,
            _branchXyc(),
            _branchClamp(address(oracle), 8),
            _branchSkewValue(address(weth), address(oracle))
        );
        bytes memory controlXyc = _standalone(_branchXyc());

        ISwapVM.Order memory primeOrder = createStrategy(primeSkew);
        ISwapVM.Order memory controlOrder = createStrategy(controlXyc);

        _shipBook(primeOrder, address(weth), address(usdc), 5 ether, 30_000e6);
        _shipBook(controlOrder, address(weth), address(usdc), 5 ether, 30_000e6);

        bytes32 primeHash = swapVM.hash(primeOrder);
        bytes32 controlHash = swapVM.hash(controlOrder);

        uint256 firstPrimeOut = _quoteOut(primeOrder, address(weth), address(usdc), 1 ether);
        uint256 firstControlOut = _quoteOut(controlOrder, address(weth), address(usdc), 1 ether);
        assertGt(firstPrimeOut, firstControlOut, "round 1: skew branch pays more USDC than plain XYC");

        console2.log("");
        console2.log("=== HEALING SEQUENCE - repeated 1 WETH sells ===");

        uint256 rounds = 4;
        for (uint256 i = 0; i < rounds; i++) {
            uint256 primeOut = _quoteOut(primeOrder, address(weth), address(usdc), 1 ether);
            uint256 controlOut = _quoteOut(controlOrder, address(weth), address(usdc), 1 ether);

            _executeSellWeth(primeOrder, 1 ether);
            _executeSellWeth(controlOrder, 1 ether);

            (uint256 pSkew,) = _usdSkewE18(primeHash, oracle);
            (uint256 cSkew,) = _usdSkewE18(controlHash, oracle);

            console2.log("--- round", i + 1);
            console2.log("prime out:", primeOut);
            console2.log("control XYC out:", controlOut);
            console2.log("prime USD skew 1e18:", pSkew);
            console2.log("control USD skew 1e18:", cSkew);
        }

        (uint256 primeSkewFinal,) = _usdSkewE18(primeHash, oracle);
        (uint256 controlSkewFinal,) = _usdSkewE18(controlHash, oracle);

        assertLt(primeSkewFinal, controlSkewFinal, "prime book stays closer to USD balance");
    }

    function _executeSellWeth(ISwapVM.Order memory order, uint256 amountIn) internal {
        weth.mint(address(taker), amountIn);
        usdc.mint(maker, 1_000_000e6);
        vm.prank(maker);
        usdc.approve(address(aqua), type(uint256).max);
        bytes memory td = takerData(address(taker), true);
        taker.swap(order, address(weth), address(usdc), amountIn, td);
    }

    function _usdSkewE18(bytes32 strategyHash, MockChainlinkAggregator oracle)
        internal
        view
        returns (uint256 absSkewE18, uint256 valueBaseUsd)
    {
        (uint256 balWeth, uint256 balUsdc) =
            aqua.safeBalances(maker, address(swapVM), strategyHash, address(weth), address(usdc));
        uint256 ethUsd = uint256(oracle.answer());
        if (oracle.decimals() < 18) {
            ethUsd = ethUsd * 10 ** (18 - oracle.decimals());
        }
        valueBaseUsd = Math.mulDiv(balWeth, ethUsd, 1e18);
        uint256 valueQuoteUsd = Math.mulDiv(balUsdc, 1e18, 1e6);
        uint256 sum = valueBaseUsd + valueQuoteUsd;
        if (sum == 0) return (0, 0);
        uint256 diff = valueBaseUsd >= valueQuoteUsd ? valueBaseUsd - valueQuoteUsd : valueQuoteUsd - valueBaseUsd;
        absSkewE18 = Math.mulDiv(diff, 1e18, sum);
    }

    function test_branch_routing_matrix_summary() public {
        MockChainlinkAggregator oracleFair = new MockChainlinkAggregator(18, 98e16);
        MockChainlinkAggregator oracleCheap = new MockChainlinkAggregator(18, 2e18);
        MockChainlinkAggregator oracleSepolia = new MockChainlinkAggregator(8, 1750e8);

        bytes memory xyc = _branchXyc();

        BranchMatrix memory balanced = _simulate(
            address(tokenA), address(tokenB), 1_000e18, 1_000e18, LAMBDA_SEPOLIA,
            xyc, _branchClamp(address(oracleFair), 18), _branchSkewRaw(SKEW_K, SKEW_MAX),
            true, 10e18
        );

        BranchMatrix memory cheap = _simulate(
            address(tokenA), address(tokenB), 1_000e18, 1_000e18, 0,
            xyc, _branchClamp(address(oracleCheap), 18), _branchSkewRaw(SKEW_K, SKEW_MAX),
            true, 10e18
        );

        BranchMatrix memory sepolia = _simulate(
            address(weth), address(usdc), 5 ether, 30_000e6, LAMBDA_SEPOLIA,
            xyc, _branchClamp(address(oracleSepolia), 8), _branchSkewValue(address(weth), address(oracleSepolia)),
            true, 1 ether
        );

        _logMatrix("SCENARIO A - expect XYC", balanced, 0);
        _logMatrix("SCENARIO B - expect CLAMP", cheap, 2e18);
        _logMatrix("SCENARIO C - expect SKEW (Sepolia)", sepolia, 1750e18);

        assertEq(balanced.winner, BRANCH_XYC);
        assertEq(cheap.winner, BRANCH_CLAMP);
        assertEq(sepolia.winner, BRANCH_SKEW);
    }
}
