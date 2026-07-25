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
import { AquaPrimeSwapGateway } from "../src/apps/AquaPrimeSwapGateway.sol";
import { AquaPrimeProgramBuilder } from "../src/apps/AquaPrimeProgramBuilder.sol";
import { PrimeSelector } from "../src/apps/PrimeSelector.sol";
import { MakerTraitsLib } from "../src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "../src/libs/TakerTraits.sol";
import { Controls, ControlsArgsBuilder } from "../src/instructions/Controls.sol";
import { Decay, DecayArgsBuilder } from "../src/instructions/Decay.sol";
import { Extruction } from "../src/instructions/Extruction.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { SkewPricer, SkewPricerArgsBuilder, SkewPricerValueArgsBuilder } from "../src/instructions/SkewPricer.sol";
import { OraclePriceAdjuster, OraclePriceAdjusterArgsBuilder } from "../src/instructions/OraclePriceAdjuster.sol";
import { Program, ProgramBuilder } from "../test/utils/ProgramBuilder.sol";
import { AquaOpcodesDebug } from "../src/opcodes/AquaOpcodesDebug.sol";
import { MainnetAddresses } from "./MainnetAddresses.sol";

// solhint-disable no-console
import { console2 } from "forge-std/console2.sol";

/// @title DeployAquaPrimeStack
/// @notice One-shot deploy for local Anvil mainnet fork: WETH/USDC Prime Desk stack.
/// @dev Program: `_decayXD` → `_extruction(PrimeSelector)` → `_salt`.
///      forge script script/DeployAquaPrimeStack.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --sender 0xf39Fd... --broadcast -vv
contract DeployAquaPrimeStack is Script, AquaOpcodesDebug {
    using ProgramBuilder for Program;
    using SafeERC20 for IERC20;

    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant WETH_WHALE = 0x28C6c06298d514Db089934071355E5743bf21d60;
    address internal constant USDC_WHALE = 0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf;
    address internal constant CHAINLINK_ETH_USD = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;

    uint256 internal constant BASE_BAL = 10 ether;
    uint256 internal constant QUOTE_BAL = 30_000e6;
    uint256 internal constant PROGRAM_SALT = 42;
    uint16 internal constant DECAY_PERIOD = 300; // 5m Mooniswap-style `_decayXD`
    uint128 internal constant SELECTOR_LAMBDA = 1e9;
    uint64 internal constant SKEW_K = 0.5e18;
    uint64 internal constant SKEW_MAX = 0.1e18;
    // Middle-ground bounds: fair-cap every branch so the desk never overpays vs Chainlink.
    uint64 internal constant SKEW_BASELINE_K = 0;
    uint64 internal constant LP_PREMIUM = 0.005e18; // 0.5% band above fair on the heal branch

    constructor() AquaOpcodesDebug(address(0)) {}

    function run() external {
        require(block.chainid == 31337, "Aqua Prime fork required (chainId 31337)");

        address deployer = msg.sender;
        Aqua aqua = Aqua(MainnetAddresses.AQUA);

        uint256 baseNonce = vm.getNonce(deployer);
        // builder, router, selector, gateway
        address predictedGateway = vm.computeCreateAddress(deployer, baseNonce + 3);

        bytes memory selectorArgs = _selectorArgs();
        bytes memory takerData = _takerData(predictedGateway);
        AquaPrimeSwapGateway.GatewayConfig memory cfg = AquaPrimeSwapGateway.GatewayConfig({
            maker: deployer,
            baseToken: WETH,
            quoteToken: USDC,
            oracle: CHAINLINK_ETH_USD,
            baseDecimals: 18,
            quoteDecimals: 6,
            oracleDecimals: 8,
            maxStaleness: 0,
            decayPeriod: DECAY_PERIOD,
            initialSalt: uint64(PROGRAM_SALT),
            initialDeskSet: AquaPrimeSwapGateway.DeskSet({
                healK: SKEW_K,
                maxAdjustment: SKEW_MAX,
                healPremium: LP_PREMIUM,
                lambda: SELECTOR_LAMBDA,
                deadline: type(uint64).max,
                attestation: bytes32(0)
            })
        });

        vm.startBroadcast();
        AquaPrimeProgramBuilder programBuilder = new AquaPrimeProgramBuilder();
        AquaSwapVMRouter router = new AquaSwapVMRouter(
            address(aqua), address(0), deployer, "AquaPrime", "1.0.0"
        );
        PrimeSelector selector = new PrimeSelector(address(aqua));
        ISwapVM.Order memory order = _order(_primeProgram(address(selector)), deployer);
        AquaPrimeSwapGateway gateway = new AquaPrimeSwapGateway(
            aqua, router, selector, programBuilder, cfg, order, takerData, selectorArgs
        );
        vm.stopBroadcast();

        require(address(gateway) == predictedGateway, "gateway address mismatch");

        _fundAccounts(deployer);
        _fundMaker(deployer, address(aqua));

        vm.startBroadcast(deployer);
        _ship(aqua, router, order);
        gateway.recordDeskShipped(BASE_BAL, QUOTE_BAL, "maker.primedesk.eth");
        vm.stopBroadcast();

        uint256 quoteOut = gateway.quoteBaseToQuote(1 ether);
        require(quoteOut > 0, "quote smoke");

        _writeManifest(deployer, aqua, router, selector, gateway, quoteOut);

        console2.log("== Aqua Prime stack deployed ==");
        console2.log("Aqua (canonical mainnet):", address(aqua));
        console2.log("Router:", address(router));
        console2.log("PrimeSelector:", address(selector));
        console2.log("Gateway:", address(gateway));
        console2.log("quote 1 WETH -> USDC:", quoteOut);
        console2.log("manifest: deployments/aqua-prime-fork.json");
    }

    function _fundAccounts(address maker) internal {
        vm.startBroadcast(WETH_WHALE);
        IERC20(WETH).safeTransfer(maker, BASE_BAL + 5 ether);
        vm.stopBroadcast();

        vm.startBroadcast(USDC_WHALE);
        IERC20(USDC).safeTransfer(maker, QUOTE_BAL + 100_000e6);
        vm.stopBroadcast();
    }

    function _fundMaker(address maker, address aqua) internal {
        vm.startBroadcast(maker);
        IERC20(WETH).forceApprove(aqua, type(uint256).max);
        IERC20(USDC).forceApprove(aqua, type(uint256).max);
        vm.stopBroadcast();
    }

    function _writeManifest(
        address deployer,
        Aqua aqua,
        AquaSwapVMRouter router,
        PrimeSelector selector,
        AquaPrimeSwapGateway gateway,
        uint256 sampleQuoteOut
    ) internal {
        string memory path = string.concat(vm.projectRoot(), "/deployments/aqua-prime-fork.json");
        string memory json = string.concat(
            '{"chainId":', vm.toString(block.chainid),
            ',"blockNumber":', vm.toString(block.number),
            ',"deployer":"', vm.toString(deployer),
            '","maker":"', vm.toString(deployer),
            '","aqua":"', vm.toString(address(aqua)),
            '","swapVMRouter":"', vm.toString(address(router)),
            '","primeSelector":"', vm.toString(address(selector)),
            '","gateway":"', vm.toString(address(gateway)),
            '","weth":"', vm.toString(WETH),
            '","usdc":"', vm.toString(USDC),
            '","baseToken":"', vm.toString(WETH),
            '","quoteToken":"', vm.toString(USDC),
            '","chainlinkEthUsd":"', vm.toString(CHAINLINK_ETH_USD),
            '","ensName":"maker.primedesk.eth"',
            ',"jarvisEns":"jarvis.primedesk.eth"',
            ',"rpcUrl":"http://127.0.0.1:8545"',
            ',"sampleQuoteOut1Eth":', vm.toString(sampleQuoteOut), "}"
        );
        vm.writeFile(path, json);
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

    function _branchXyc() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return p.build(XYCSwap._xycSwapXD);
    }

    function _branchClamp() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(
                OraclePriceAdjuster._oraclePriceAdjuster1D,
                OraclePriceAdjusterArgsBuilder.build(0.95e18, 0, 8, CHAINLINK_ETH_USD)
            )
        );
    }

    /// @dev Chainlink-fair-bounded inventory skew branch (see SkewPricer bounded mode).
    function _branchSkewBounded(uint64 k, uint64 premium) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.buildBounded(
                    k, SKEW_MAX, 18, 6, 8, 0, WETH, CHAINLINK_ETH_USD, premium
                )
            )
        );
    }

    /// @notice Two-branch desk: baseline + heal. XYC/ORACLE are UI reference only.
    function _selectorArgs() internal view returns (bytes memory) {
        bytes memory baseline = _branchSkewBounded(SKEW_BASELINE_K, 0);
        bytes memory heal = _branchSkewBounded(SKEW_K, LP_PREMIUM);
        return abi.encodePacked(
            SELECTOR_LAMBDA,
            uint8(2),
            uint16(baseline.length), baseline,
            uint16(heal.length), heal
        );
    }

    function _primeProgram(address selector) internal view returns (bytes memory) {
        bytes memory extructionArgs = abi.encodePacked(selector, _selectorArgs());
        require(extructionArgs.length <= 255, "extruction args overflow");
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(Decay._decayXD, DecayArgsBuilder.build(DECAY_PERIOD)),
            p.build(Extruction._extruction, extructionArgs),
            p.build(Controls._salt, ControlsArgsBuilder.buildSalt(uint64(PROGRAM_SALT)))
        );
    }

    function _ship(Aqua aqua, AquaSwapVMRouter router, ISwapVM.Order memory order) internal {
        bytes memory strategy = abi.encode(order);
        address[] memory tokens = new address[](2);
        tokens[0] = WETH;
        tokens[1] = USDC;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BASE_BAL;
        amounts[1] = QUOTE_BAL;
        aqua.ship(address(router), strategy, tokens, amounts);
    }
}
// solhint-enable no-console
