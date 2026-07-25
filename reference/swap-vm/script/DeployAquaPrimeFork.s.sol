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
import { PrimeSelector } from "../src/apps/PrimeSelector.sol";
import { ForkTaker } from "../test/mocks/ForkTaker.sol";
import { Program, ProgramBuilder } from "../test/utils/ProgramBuilder.sol";
import { AquaOpcodesDebug } from "../src/opcodes/AquaOpcodesDebug.sol";
import { MainnetAddresses } from "./MainnetAddresses.sol";

// solhint-disable no-console
import { console2 } from "forge-std/console2.sol";

/// @title DeployAquaPrimeFork
/// @notice Ship Aqua Prime on canonical mainnet Aqua + custom router; smoke-test ship → quote → swap.
/// @dev Uses `MainnetAddresses.AQUA` — do not deploy a fresh Aqua registry on a mainnet fork.
///      Writes `deployments/aqua-prime-fork.json` with deployed addresses.
///
///      1) anvil --fork-url $MAINNET_RPC_URL --chain-id 1 --port 8545
///      2) forge script script/DeployAquaPrimeFork.s.sol --rpc-url http://127.0.0.1:8545 --broadcast -vv
contract DeployAquaPrimeFork is Script, AquaOpcodesDebug {
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
        require(block.chainid == 1, "mainnet fork required (chainId 1)");

        address deployer = msg.sender;
        Aqua aqua = Aqua(MainnetAddresses.AQUA);

        (AquaSwapVMRouter swapVM, PrimeSelector selector, ForkTaker taker) = _deployCore(deployer, aqua);
        _fundAndApprove(deployer, address(taker), aqua, swapVM);

        bytes memory program = _skewProgram();
        ISwapVM.Order memory order = _order(program, deployer);

        vm.startBroadcast(deployer);
        bytes32 strategyHash = _ship(aqua, swapVM, order);
        vm.stopBroadcast();

        (uint256 quoteIn, uint256 quoteOut,) =
            swapVM.asView().quote(order, USDC, USDT, SWAP_IN, _takerData(address(taker)));

        vm.startBroadcast(deployer);
        (uint256 swapIn, uint256 swapOut) = taker.swap(order, USDC, USDT, SWAP_IN, _takerData(address(taker)));
        vm.stopBroadcast();
        require(swapIn == quoteIn && swapOut == quoteOut, "smoke: quote!=swap");
        require(swapOut > 0, "smoke: zero output");

        (uint256 balUsdc, uint256 balUsdt) = aqua.safeBalances(deployer, address(swapVM), strategyHash, USDC, USDT);
        require(balUsdc == BAL + swapIn, "smoke: virtual USDC");
        require(balUsdt == BAL - swapOut, "smoke: virtual USDT");

        _writeManifest(deployer, aqua, swapVM, selector, taker, swapIn, swapOut);
        _logSummary(aqua, swapVM, selector, taker, swapIn, swapOut);
    }

    function _deployCore(address deployer, Aqua aqua)
        internal
        returns (AquaSwapVMRouter swapVM, PrimeSelector selector, ForkTaker taker)
    {
        vm.startBroadcast();
        swapVM = new AquaSwapVMRouter(address(aqua), address(0), deployer, "AquaPrime", "1.0.0");
        selector = new PrimeSelector(address(aqua));
        taker = new ForkTaker(aqua, swapVM, deployer);
        vm.stopBroadcast();
    }

    function _fundAndApprove(address maker, address takerAddr, Aqua aqua, AquaSwapVMRouter swapVM) internal {
        vm.startBroadcast(USDT_WHALE);
        IERC20(USDT).safeTransfer(maker, FUND);
        vm.stopBroadcast();

        vm.startBroadcast(maker);
        IERC20(USDT).forceApprove(address(aqua), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(USDC_WHALE);
        IERC20(USDC).safeTransfer(takerAddr, FUND);
        vm.stopBroadcast();

        vm.startBroadcast(takerAddr);
        IERC20(USDC).forceApprove(address(swapVM), type(uint256).max);
        vm.stopBroadcast();
    }

    function _writeManifest(
        address deployer,
        Aqua aqua,
        AquaSwapVMRouter swapVM,
        PrimeSelector selector,
        ForkTaker taker,
        uint256 swapIn,
        uint256 swapOut
    ) internal {
        string memory path = string.concat(vm.projectRoot(), "/deployments/aqua-prime-fork.json");
        string memory json = string.concat(
            '{"chainId":', vm.toString(block.chainid),
            ',"blockNumber":', vm.toString(block.number),
            ',"deployer":"', vm.toString(deployer),
            '","aqua":"', vm.toString(address(aqua)),
            '","swapVMRouter":"', vm.toString(address(swapVM)),
            '","primeSelector":"', vm.toString(address(selector)),
            '","forkTaker":"', vm.toString(address(taker)),
            '","rpcUrl":"http://127.0.0.1:8545"',
            ',"smokeSwapIn":', vm.toString(swapIn),
            ',"smokeSwapOut":', vm.toString(swapOut), "}"
        );
        vm.writeFile(path, json);
    }

    function _logSummary(
        Aqua aqua,
        AquaSwapVMRouter swapVM,
        PrimeSelector selector,
        ForkTaker taker,
        uint256 swapIn,
        uint256 swapOut
    ) internal view {
        console2.log("== Aqua Prime fork deploy OK ==");
        console2.log("chainId:", block.chainid);
        console2.log("block:", block.number);
        console2.log("Aqua (canonical mainnet):", address(aqua));
        console2.log("AquaSwapVMRouter:", address(swapVM));
        console2.log("PrimeSelector:", address(selector));
        console2.log("ForkTaker:", address(taker));
        console2.log("smoke swap USDC->USDT in/out:", swapIn, swapOut);
        console2.log("manifest: deployments/aqua-prime-fork.json");
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
