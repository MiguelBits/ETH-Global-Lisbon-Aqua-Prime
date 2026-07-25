// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Script } from "forge-std/Script.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@1inch/solidity-utils/contracts/libraries/SafeERC20.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "../src/SwapVM.sol";
import { AquaSwapVMRouter } from "../src/routers/AquaSwapVMRouter.sol";
import { MakerTraitsLib } from "../src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "../src/libs/TakerTraits.sol";
import { Controls, ControlsArgsBuilder } from "../src/instructions/Controls.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { SkewPricer, SkewPricerArgsBuilder } from "../src/instructions/SkewPricer.sol";
import { ForkTaker } from "../test/mocks/ForkTaker.sol";
import { Program, ProgramBuilder } from "../test/utils/ProgramBuilder.sol";
import { AquaOpcodesDebug } from "../src/opcodes/AquaOpcodesDebug.sol";

// solhint-disable no-console
import { console2 } from "forge-std/console2.sol";

/// @title VerifyAquaPrimeFork
/// @notice Completes funding + ship + swap against already-deployed contracts on the running Anvil fork.
/// @dev Run after DeployAquaPrimeFork when contract CREATE txs succeeded but funding txs failed:
///      forge script script/VerifyAquaPrimeFork.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --sender 0xf39Fd... --broadcast -vv
contract VerifyAquaPrimeFork is Script, AquaOpcodesDebug {
    using ProgramBuilder for Program;
    using SafeERC20 for IERC20;

    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address internal constant USDC_WHALE = 0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf;
    address internal constant USDT_WHALE = 0xF977814e90dA44bFA03b6295A0616a897441aceC;

    uint256 internal constant BAL = 100_000e6;
    uint256 internal constant SWAP_IN = 10_000e6;
    uint256 internal constant FUND = 2_000_000e6;

    constructor() AquaOpcodesDebug(address(0)) {}

    function run() external {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/aqua-prime-fork.json"));
        address aqua = vm.parseJsonAddress(json, ".aqua");
        address router = vm.parseJsonAddress(json, ".swapVMRouter");
        address taker = vm.parseJsonAddress(json, ".forkTaker");
        address maker = vm.parseJsonAddress(json, ".deployer");

        AquaSwapVMRouter swapVM = AquaSwapVMRouter(payable(router));
        ForkTaker takerC = ForkTaker(taker);

        bytes memory program = _skewProgram();
        ISwapVM.Order memory order = _order(program, maker);

        vm.startBroadcast(maker);
        bytes32 strategyHash = _ship(Aqua(aqua), swapVM, order);
        vm.stopBroadcast();

        (uint256 quoteIn, uint256 quoteOut,) = swapVM.asView().quote(order, USDC, USDT, SWAP_IN, _takerData(taker));

        vm.startBroadcast(maker);
        (uint256 swapIn, uint256 swapOut) = takerC.swap(order, USDC, USDT, SWAP_IN, _takerData(taker));
        vm.stopBroadcast();

        require(swapIn == quoteIn && swapOut == quoteOut, "verify: quote!=swap");
        (uint256 balUsdc, uint256 balUsdt) = Aqua(aqua).safeBalances(maker, router, strategyHash, USDC, USDT);
        require(balUsdc == BAL + swapIn && balUsdt == BAL - swapOut, "verify: virtual balances");

        _updateManifest(json, swapIn, swapOut);

        console2.log("== Aqua Prime fork verify OK ==");
        console2.log("Aqua:", aqua);
        console2.log("Router:", router);
        console2.log("Taker:", taker);
        console2.log("swap in/out:", swapIn, swapOut);
        console2.log("virtual USDC/USDT:", balUsdc, balUsdt);
    }

    function _updateManifest(string memory json, uint256 swapIn, uint256 swapOut) internal {
        json;
        string memory path = string.concat(vm.projectRoot(), "/deployments/aqua-prime-fork.json");
        string memory out = vm.readFile(path);
        // keep addresses; overwrite smoke fields only by rebuilding minimal json from parsed values
        address aqua = vm.parseJsonAddress(out, ".aqua");
        address router = vm.parseJsonAddress(out, ".swapVMRouter");
        address selector = vm.parseJsonAddress(out, ".primeSelector");
        address taker = vm.parseJsonAddress(out, ".forkTaker");
        address maker = vm.parseJsonAddress(out, ".deployer");
        string memory updated = string.concat(
            '{"chainId":', vm.toString(block.chainid),
            ',"blockNumber":', vm.toString(block.number),
            ',"deployer":"', vm.toString(maker),
            '","aqua":"', vm.toString(aqua),
            '","swapVMRouter":"', vm.toString(router),
            '","primeSelector":"', vm.toString(selector),
            '","forkTaker":"', vm.toString(taker),
            '","rpcUrl":"http://127.0.0.1:8545"',
            ',"smokeSwapIn":', vm.toString(swapIn),
            ',"smokeSwapOut":', vm.toString(swapOut), "}"
        );
        vm.writeFile(path, updated);
    }

    function _order(bytes memory program, address maker) internal pure returns (ISwapVM.Order memory) {
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

    function _takerData(address taker) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: taker,
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

    function _skewProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(SkewPricer._skewPricer, SkewPricerArgsBuilder.build(0.5e18, 0.1e18)),
            p.build(Controls._salt, ControlsArgsBuilder.buildSalt(uint64(block.timestamp)))
        );
    }

    function _ship(Aqua aqua, AquaSwapVMRouter swapVM, ISwapVM.Order memory order) internal returns (bytes32 strategyHash) {
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
}
// solhint-enable no-console
