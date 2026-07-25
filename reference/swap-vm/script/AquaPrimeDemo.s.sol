// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Script } from "forge-std/Script.sol";

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
import { IPriceOracle } from "../src/instructions/interfaces/IPriceOracle.sol";
import { AquaOpcodesDebug } from "../src/opcodes/AquaOpcodesDebug.sol";
import { ForkTaker } from "../test/mocks/ForkTaker.sol";
import { Program, ProgramBuilder } from "../test/utils/ProgramBuilder.sol";

// solhint-disable no-console
import { console2 } from "forge-std/console2.sol";

/// @title AquaPrimeDemo — mainnet-fork showcase of inventory-healing quote skew
/// @notice Simulation-only forge script (do NOT --broadcast). Forks mainnet, ships two identical stable books
///         — a plain-XYC control and an Aqua Prime SkewPricer book — then applies the SAME one-directional
///         pressure to both and prints how the skew book heals its inventory faster round by round.
/// @dev Run: forge script script/AquaPrimeDemo.s.sol --rpc-url $MAINNET_RPC_URL -vv
///      Requires a mainnet RPC (defaults to https://ethereum.publicnode.com).
contract AquaPrimeDemo is Script, AquaOpcodesDebug {
    using ProgramBuilder for Program;
    using SafeERC20 for IERC20;

    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address internal constant USDC_WHALE = 0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf;
    address internal constant USDT_WHALE = 0xF977814e90dA44bFA03b6295A0616a897441aceC;
    address internal constant CHAINLINK_USDT_USD = 0x3E7d1eAB13ad0104d2750B8863b489D65364e32D;

    uint256 internal constant BAL = 100_000e6;
    uint256 internal constant SWAP_IN = 10_000e6;
    uint256 internal constant FUND = 2_000_000e6;
    uint256 internal constant ROUNDS = 6;

    // Dedicated maker EOA: forge scripts forbid relying on the ephemeral script contract's `address(this)`.
    address internal constant MAKER = address(0xA11CE);

    Aqua internal aqua;
    AquaSwapVMRouter internal swapVM;
    ForkTaker internal taker;
    address internal maker;

    constructor() AquaOpcodesDebug(address(0)) {}

    function run() external {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string("https://ethereum.publicnode.com"));
        vm.createSelectFork(rpc);

        maker = MAKER;
        aqua = new Aqua();
        swapVM = new AquaSwapVMRouter(address(aqua), address(0), maker, "AquaPrime", "1.0.0");
        taker = new ForkTaker(aqua, swapVM, maker);

        _fund(USDT, maker, FUND);
        vm.prank(maker);
        IERC20(USDT).forceApprove(address(aqua), type(uint256).max);
        _fund(USDC, address(taker), FUND);
        vm.prank(address(taker));
        IERC20(USDC).forceApprove(address(swapVM), type(uint256).max);

        (, int256 usdtUsd,,,) = IPriceOracle(CHAINLINK_USDT_USD).latestRoundData();
        console2.log("== Aqua Prime demo | mainnet fork, block:", block.number);
        console2.log("   live Chainlink USDT/USD (1e8):", uint256(usdtUsd));
        console2.log("   pressure: buy USDT with USDC, 10k per round, both books start 100k/100k");
        console2.log("");

        ISwapVM.Order memory control = _order(_xycProgram());
        ISwapVM.Order memory prime = _order(_skewProgram());
        bytes32 controlHash = _ship(control);
        bytes32 primeHash = _ship(prime);

        console2.log("round |  XYC |skew(1e18)|  Prime|skew(1e18) | scarce USDT left: XYC vs Prime");
        for (uint256 i = 1; i <= ROUNDS; i++) {
            vm.prank(maker);
            taker.swap(control, USDC, USDT, SWAP_IN, _takerData());
            vm.prank(maker);
            taker.swap(prime, USDC, USDT, SWAP_IN, _takerData());

            (, uint256 cUsdt) = aqua.safeBalances(maker, address(swapVM), controlHash, USDC, USDT);
            (, uint256 pUsdt) = aqua.safeBalances(maker, address(swapVM), primeHash, USDC, USDT);
            console2.log("round", i);
            console2.log("   control skew:", _absSkewE18(controlHash), " USDT left:", cUsdt);
            console2.log("   prime   skew:", _absSkewE18(primeHash), " USDT left:", pUsdt);
        }

        console2.log("");
        console2.log("Result: the SkewPricer book carries LESS imbalance and preserves MORE of the scarce");
        console2.log("out-token under identical flow -> maker-side best execution via inventory healing.");
    }

    // ===== helpers =====

    function _fund(address token, address to, uint256 amount) internal {
        address whale = token == USDC ? USDC_WHALE : USDT_WHALE;
        vm.prank(whale);
        IERC20(token).safeTransfer(to, amount);
    }

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

    function _xycProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
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

    function _ship(ISwapVM.Order memory order) internal returns (bytes32 strategyHash) {
        strategyHash = swapVM.hash(order);
        bytes memory strategy = abi.encode(order);
        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = USDT;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BAL;
        amounts[1] = BAL;
        vm.prank(maker);
        aqua.ship(address(swapVM), strategy, tokens, amounts);
    }

    function _absSkewE18(bytes32 strategyHash) internal view returns (uint256) {
        (uint256 balUsdc, uint256 balUsdt) = aqua.safeBalances(maker, address(swapVM), strategyHash, USDC, USDT);
        uint256 sum = balUsdc + balUsdt;
        if (sum == 0) return 0;
        uint256 diff = balUsdc >= balUsdt ? balUsdc - balUsdt : balUsdt - balUsdc;
        return (diff * 1e18) / sum;
    }
}
// solhint-enable no-console
