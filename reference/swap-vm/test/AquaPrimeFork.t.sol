// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Test } from "forge-std/Test.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@1inch/solidity-utils/contracts/libraries/SafeERC20.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { SwapVM, ISwapVM } from "../src/SwapVM.sol";
import { AquaSwapVMRouter } from "../src/routers/AquaSwapVMRouter.sol";
import { MakerTraitsLib } from "../src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "../src/libs/TakerTraits.sol";
import { Controls, ControlsArgsBuilder } from "../src/instructions/Controls.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { SkewPricer, SkewPricerArgsBuilder } from "../src/instructions/SkewPricer.sol";
import { OraclePriceAdjuster, OraclePriceAdjusterArgsBuilder } from "../src/instructions/OraclePriceAdjuster.sol";
import { IPriceOracle } from "../src/instructions/interfaces/IPriceOracle.sol";
import { AquaOpcodesDebug } from "../src/opcodes/AquaOpcodesDebug.sol";
import { ForkTaker } from "./mocks/ForkTaker.sol";
import { Program, ProgramBuilder } from "./utils/ProgramBuilder.sol";

/// @title Aqua Prime — mainnet fork proof
/// @notice Runs Aqua Prime against real mainnet state: live Chainlink feeds and real ERC20 settlement.
/// @dev Uses a USDC/USDT stable desk (both 6 decimals, ~1:1) so the raw-balance skew and the oracle bound
///      are economically meaningful — the intended market for inventory-healing quote skew. WETH/USDC is
///      not used for the skew math because the 18/6 decimal + ~3000:1 price gap pins raw skew near ±1
///      (documented limitation); the ETH/USD feed is still read in the health check.
///
///      RPC: set MAINNET_RPC_URL (e.g. https://ethereum.publicnode.com). Forks latest unless
///      MAINNET_FORK_BLOCK is set. Never `deal()` proxy stablecoins — fund from a whale.
contract AquaPrimeForkTest is Test, AquaOpcodesDebug {
    using ProgramBuilder for Program;
    using SafeERC20 for IERC20;

    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    // No single mainnet account reliably holds 1M of BOTH stables, so we fund each token from its own whale.
    address internal constant USDC_WHALE = 0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf; // >1B USDC
    address internal constant USDT_WHALE = 0xF977814e90dA44bFA03b6295A0616a897441aceC; // Binance 8: >1B USDT
    address internal constant CHAINLINK_ETH_USD = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419; // 8 decimals
    address internal constant CHAINLINK_USDT_USD = 0x3E7d1eAB13ad0104d2750B8863b489D65364e32D; // 8 decimals

    uint256 internal constant BAL = 100_000e6; // balanced stable book
    uint256 internal constant SWAP_IN = 10_000e6;
    uint256 internal constant FUND = 1_000_000e6;

    Aqua public aqua;
    SwapVM public swapVM;
    ForkTaker public taker;
    address public maker;

    constructor() AquaOpcodesDebug(address(0)) {}

    function _fund(address token, address to, uint256 amount) internal {
        address whale = token == USDC ? USDC_WHALE : USDT_WHALE;
        require(IERC20(token).balanceOf(whale) >= amount, "whale underfunded on fork");
        vm.prank(whale);
        IERC20(token).safeTransfer(to, amount);
    }

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string("https://ethereum.publicnode.com"));
        uint256 forkBlock = vm.envOr("MAINNET_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) {
            vm.createSelectFork(rpc);
        } else {
            vm.createSelectFork(rpc, forkBlock);
        }

        aqua = new Aqua();
        swapVM = new AquaSwapVMRouter(address(aqua), address(0), address(this), "AquaPrime", "1.0.0");
        taker = new ForkTaker(aqua, swapVM, address(this));
        maker = address(this);

        // maker holds both stables (pays out on pull) and approves Aqua
        _fund(USDC, maker, FUND);
        _fund(USDT, maker, FUND);
        IERC20(USDC).forceApprove(address(aqua), type(uint256).max);
        IERC20(USDT).forceApprove(address(aqua), type(uint256).max);

        // taker holds both stables (pays in on push) and approves both venues
        _fund(USDC, address(taker), FUND);
        _fund(USDT, address(taker), FUND);
        vm.prank(address(taker));
        IERC20(USDC).forceApprove(address(swapVM), type(uint256).max);
        vm.prank(address(taker));
        IERC20(USDT).forceApprove(address(swapVM), type(uint256).max);
    }

    // ===== program + order builders =====

    function _order(bytes memory program) internal view returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: program
        }));
    }

    function _takerData() internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(taker),
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: false,
            threshold: "",
            to: address(0),
            deadline: 0,
            hasPreTransferInCallback: true,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: ""
        }));
    }

    function _oracleProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            // maxStaleness = 0 skips the freshness gate: USDT/USD has a ~24h heartbeat, so a fork at an
            // arbitrary latest block would otherwise flakily revert. The feed is still read live.
            p.build(OraclePriceAdjuster._oraclePriceAdjuster1D, OraclePriceAdjusterArgsBuilder.build(0.95e18, 0, 8, CHAINLINK_USDT_USD)),
            p.build(Controls._salt, ControlsArgsBuilder.buildSalt(uint64(vm.randomUint())))
        );
    }

    function _skewProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(SkewPricer._skewPricer, SkewPricerArgsBuilder.build(0.5e18, 0.1e18)),
            p.build(Controls._salt, ControlsArgsBuilder.buildSalt(uint64(vm.randomUint())))
        );
    }

    function _xycProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, ControlsArgsBuilder.buildSalt(uint64(vm.randomUint())))
        );
    }

    function _ship(ISwapVM.Order memory order) internal returns (bytes32 strategyHash) {
        strategyHash = swapVM.hash(order);
        bytes memory strategy = abi.encode(order);
        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = USDT;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BAL;
        amounts[1] = BAL;
        aqua.ship(address(swapVM), strategy, tokens, amounts);
    }

    function _swapUsdcForUsdt(ISwapVM.Order memory order, uint256 amountIn) internal returns (uint256, uint256) {
        return taker.swap(order, USDC, USDT, amountIn, _takerData());
    }

    function _absSkewE18(bytes32 strategyHash) internal view returns (uint256) {
        (uint256 balUsdc, uint256 balUsdt) = aqua.safeBalances(maker, address(swapVM), strategyHash, USDC, USDT);
        uint256 sum = balUsdc + balUsdt;
        if (sum == 0) return 0;
        uint256 diff = balUsdc >= balUsdt ? balUsdc - balUsdt : balUsdt - balUsdc;
        return (diff * 1e18) / sum;
    }

    // ===== tests =====

    function test_fork_setup_health() public view {
        assertEq(block.chainid, 1, "must run on a mainnet fork");

        (, int256 ethUsd,, uint256 ethUpdatedAt,) = IPriceOracle(CHAINLINK_ETH_USD).latestRoundData();
        assertGt(ethUsd, 100e8, "ETH/USD sanity lower bound");
        assertLt(ethUsd, 100_000e8, "ETH/USD sanity upper bound");
        assertGt(ethUpdatedAt, 0, "ETH/USD feed answered");

        (, int256 usdtUsd,,,) = IPriceOracle(CHAINLINK_USDT_USD).latestRoundData();
        assertGt(usdtUsd, 0.9e8, "USDT/USD near peg (lower)");
        assertLt(usdtUsd, 1.1e8, "USDT/USD near peg (upper)");

        assertGe(IERC20(USDT).balanceOf(maker), BAL, "maker funded with USDT");
        assertGe(IERC20(USDC).balanceOf(address(taker)), SWAP_IN, "taker funded with USDC");
    }

    function test_fork_swap_with_live_chainlink() public {
        ISwapVM.Order memory order = _order(_oracleProgram());
        bytes32 strategyHash = _ship(order);

        uint256 takerUsdcBefore = IERC20(USDC).balanceOf(address(taker));
        uint256 takerUsdtBefore = IERC20(USDT).balanceOf(address(taker));

        (uint256 amountIn, uint256 amountOut) = _swapUsdcForUsdt(order, SWAP_IN);

        assertEq(amountIn, SWAP_IN, "exact-in amountIn");
        assertGt(amountOut, 0, "amountOut positive");

        // real ERC20 settlement
        assertEq(takerUsdcBefore - IERC20(USDC).balanceOf(address(taker)), amountIn, "taker pays USDC");
        assertEq(IERC20(USDT).balanceOf(address(taker)) - takerUsdtBefore, amountOut, "taker receives USDT");

        // virtual balance settlement
        (uint256 balUsdc, uint256 balUsdt) = aqua.safeBalances(maker, address(swapVM), strategyHash, USDC, USDT);
        assertEq(balUsdc, BAL + amountIn, "virtual USDC += amountIn");
        assertEq(balUsdt, BAL - amountOut, "virtual USDT -= amountOut");
    }

    function test_fork_quote_matches_swap() public {
        ISwapVM.Order memory order = _order(_oracleProgram());
        _ship(order);

        (uint256 quoteIn, uint256 quoteOut,) = swapVM.asView().quote(order, USDC, USDT, SWAP_IN, _takerData());
        (uint256 amountIn, uint256 amountOut) = _swapUsdcForUsdt(order, SWAP_IN);

        assertEq(amountIn, quoteIn, "fork amountIn quote==swap");
        assertEq(amountOut, quoteOut, "fork amountOut quote==swap");
    }

    function test_fork_inventory_healing_sequence() public {
        // Control strategy (plain XYC) vs Prime strategy (XYC + skew), identical balanced books.
        ISwapVM.Order memory control = _order(_xycProgram());
        ISwapVM.Order memory prime = _order(_skewProgram());
        bytes32 controlHash = _ship(control);
        bytes32 primeHash = _ship(prime);

        // Same-direction pressure: repeatedly buy USDT (deplete the out-token) on both books.
        uint256 rounds = 5;
        for (uint256 i = 0; i < rounds; i++) {
            _swapUsdcForUsdt(control, SWAP_IN);
            _swapUsdcForUsdt(prime, SWAP_IN);
        }

        uint256 controlSkew = _absSkewE18(controlHash);
        uint256 primeSkew = _absSkewE18(primeHash);

        // Skew charges more as USDT gets scarce, so it depletes the thin side slower => less imbalance.
        assertLt(primeSkew, controlSkew, "skew must slow inventory imbalance growth vs plain XYC");

        (, uint256 controlUsdt) = aqua.safeBalances(maker, address(swapVM), controlHash, USDC, USDT);
        (, uint256 primeUsdt) = aqua.safeBalances(maker, address(swapVM), primeHash, USDC, USDT);
        assertGt(primeUsdt, controlUsdt, "skew preserves more of the scarce out-token");
    }
}
