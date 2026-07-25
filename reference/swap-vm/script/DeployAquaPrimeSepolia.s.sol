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
import { PrimeFaucetToken } from "../src/mocks/PrimeFaucetToken.sol";
import { MakerTraitsLib } from "../src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "../src/libs/TakerTraits.sol";
import { Controls, ControlsArgsBuilder } from "../src/instructions/Controls.sol";
import { Decay, DecayArgsBuilder } from "../src/instructions/Decay.sol";
import { Extruction } from "../src/instructions/Extruction.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { SkewPricer, SkewPricerValueArgsBuilder } from "../src/instructions/SkewPricer.sol";
import { OraclePriceAdjuster, OraclePriceAdjusterArgsBuilder } from "../src/instructions/OraclePriceAdjuster.sol";
import { Program, ProgramBuilder } from "../test/utils/ProgramBuilder.sol";
import { AquaOpcodesDebug } from "../src/opcodes/AquaOpcodesDebug.sol";
import { SepoliaAddresses } from "./SepoliaAddresses.sol";

// solhint-disable no-console
import { console2 } from "forge-std/console2.sol";

/// @title DeployAquaPrimeSepolia
/// @notice Deploy the full Prime Desk stack on Sepolia (or a Sepolia fork):
///         faucet WETH/USDC → Aqua → router → PrimeSelector → gateway, then ship a
///         deliberately USD-IMBALANCED book so the SkewPricer branch diverges from XYC.
/// @dev Program: `_decayXD` → `_extruction(PrimeSelector)` → `_salt`.
///      Broadcast: forge script script/DeployAquaPrimeSepolia.s.sol --rpc-url $SEPOLIA_RPC --broadcast -vv
///      Uses mintable faucet tokens (no external faucet needed) + the real Sepolia Chainlink ETH/USD feed.
contract DeployAquaPrimeSepolia is Script, AquaOpcodesDebug {
    using ProgramBuilder for Program;
    using SafeERC20 for IERC20;

    address internal constant CHAINLINK_ETH_USD = SepoliaAddresses.CHAINLINK_ETH_USD;

    // Deliberately imbalanced in USD terms (@ ~$3k ETH): BASE ~= $15k vs QUOTE = $30k.
    // Book is QUOTE(USDC)-heavy, so selling WETH heals it → SkewPricer quotes MORE USDC than XYC and wins routing.
    uint256 internal constant BASE_BAL = 5 ether;
    uint256 internal constant QUOTE_BAL = 30_000e6;

    // Extra headroom minted to the maker on top of the shipped book.
    uint256 internal constant MAKER_BASE_EXTRA = 5 ether;
    uint256 internal constant MAKER_QUOTE_EXTRA = 20_000e6;

    // Public faucet chunk sizes (per faucet() call).
    uint256 internal constant WETH_FAUCET = 5 ether;
    uint256 internal constant USDC_FAUCET = 20_000e6;

    uint256 internal constant PROGRAM_SALT = 42;
    uint16 internal constant DECAY_PERIOD = 300; // 5m Mooniswap-style `_decayXD`
    uint128 internal constant SELECTOR_LAMBDA = 1e9;
    uint64 internal constant SKEW_K = 0.5e18;
    uint64 internal constant SKEW_MAX = 0.1e18;
    // Middle-ground bounds: every branch is Chainlink-fair-capped so the desk never pays a taker
    // above fair value (LP is never worse off than the mark). The heal branch tolerates a tiny
    // premium to attract inventory-healing flow; the baseline branch is strict fair (k = 0).
    uint64 internal constant SKEW_BASELINE_K = 0;
    uint64 internal constant LP_PREMIUM = 0.005e18; // 0.5% band above fair on the heal branch
    uint8 internal constant BASE_DECIMALS = 18;
    uint8 internal constant QUOTE_DECIMALS = 6;
    uint16 internal constant ORACLE_STALENESS = 3600;
    uint8 internal constant ORACLE_DECIMALS = 8;

    constructor() AquaOpcodesDebug(address(0)) {}

    function run() external {
        require(block.chainid == 11_155_111 || block.chainid == 31_337, "Sepolia or Sepolia fork required");

        address deployer = msg.sender;

        // 1) Deploy mintable faucet tokens first so their addresses can be embedded in the skew branch args.
        vm.startBroadcast();
        PrimeFaucetToken weth = new PrimeFaucetToken("Prime Wrapped Ether", "pWETH", BASE_DECIMALS, WETH_FAUCET);
        PrimeFaucetToken usdc = new PrimeFaucetToken("Prime USD Coin", "pUSDC", QUOTE_DECIMALS, USDC_FAUCET);
        vm.stopBroadcast();

        // 2) Build selector args + predict gateway (aqua+router+selector+builder+gateway).
        bytes memory selectorArgs = _selectorArgs(address(weth));
        uint256 baseNonce = vm.getNonce(deployer);
        address predictedGateway = vm.computeCreateAddress(deployer, baseNonce + 4);
        bytes memory takerData = _takerData(predictedGateway);
        AquaPrimeSwapGateway.GatewayConfig memory cfg = AquaPrimeSwapGateway.GatewayConfig({
            maker: deployer,
            baseToken: address(weth),
            quoteToken: address(usdc),
            oracle: CHAINLINK_ETH_USD,
            baseDecimals: BASE_DECIMALS,
            quoteDecimals: QUOTE_DECIMALS,
            oracleDecimals: ORACLE_DECIMALS,
            maxStaleness: ORACLE_STALENESS,
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

        // 3) Deploy the stack.
        vm.startBroadcast();
        Aqua aqua = new Aqua();
        AquaSwapVMRouter router = new AquaSwapVMRouter(address(aqua), address(0), deployer, "PrimeDesk", "1.0.0");
        PrimeSelector selector = new PrimeSelector(address(aqua));
        AquaPrimeProgramBuilder programBuilder = new AquaPrimeProgramBuilder();
        ISwapVM.Order memory order = _order(_primeProgram(address(selector), address(weth)), deployer);
        AquaPrimeSwapGateway gateway = new AquaPrimeSwapGateway(
            aqua, router, selector, programBuilder, cfg, order, takerData, selectorArgs
        );
        vm.stopBroadcast();

        require(address(gateway) == predictedGateway, "gateway address mismatch");

        // 4) Fund the maker (mint faucet tokens — works on live Sepolia, no whale/faucet dependency).
        vm.startBroadcast();
        weth.mint(deployer, BASE_BAL + MAKER_BASE_EXTRA);
        usdc.mint(deployer, QUOTE_BAL + MAKER_QUOTE_EXTRA);
        IERC20(address(weth)).forceApprove(address(aqua), type(uint256).max);
        IERC20(address(usdc)).forceApprove(address(aqua), type(uint256).max);
        _ship(aqua, router, order, address(weth), address(usdc));
        gateway.recordDeskShipped(BASE_BAL, QUOTE_BAL, "maker.primedesk.eth");
        vm.stopBroadcast();

        uint256 quoteOut = gateway.quoteBaseToQuote(1 ether);
        require(quoteOut > 0, "quote smoke");

        _writeManifest(deployer, aqua, router, selector, gateway, address(weth), address(usdc), quoteOut);

        console2.log("== Prime Desk Sepolia deployed ==");
        console2.log("Aqua:", address(aqua));
        console2.log("Router:", address(router));
        console2.log("PrimeSelector:", address(selector));
        console2.log("Gateway:", address(gateway));
        console2.log("pWETH:", address(weth));
        console2.log("pUSDC:", address(usdc));
        console2.log("quote 1 WETH -> USDC:", quoteOut);
        console2.log("manifest: deployments/aqua-prime-sepolia.json");
    }

    function _writeManifest(
        address deployer,
        Aqua aqua,
        AquaSwapVMRouter router,
        PrimeSelector selector,
        AquaPrimeSwapGateway gateway,
        address weth,
        address usdc,
        uint256 sampleQuoteOut1Eth
    ) internal {
        string memory path = string.concat(vm.projectRoot(), "/deployments/aqua-prime-sepolia.json");
        string memory json = string.concat(
            '{"chainId":', vm.toString(block.chainid),
            ',"blockNumber":', vm.toString(block.number),
            ',"deployer":"', vm.toString(deployer),
            '","maker":"', vm.toString(deployer),
            '","aqua":"', vm.toString(address(aqua)),
            '","swapVMRouter":"', vm.toString(address(router)),
            '","primeSelector":"', vm.toString(address(selector)),
            '","gateway":"', vm.toString(address(gateway)),
            '","weth":"', vm.toString(weth),
            '","usdc":"', vm.toString(usdc),
            '","baseToken":"', vm.toString(weth),
            '","quoteToken":"', vm.toString(usdc),
            '","chainlinkEthUsd":"', vm.toString(CHAINLINK_ETH_USD),
            '","mintableTokens":true',
            ',"ensName":"maker.primedesk.eth"',
            ',"jarvisEns":"jarvis.primedesk.eth"',
            ',"rpcUrl":"https://rpc.sepolia.org"',
            ',"sampleQuoteOut1Eth":', vm.toString(sampleQuoteOut1Eth), "}"
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
                OraclePriceAdjusterArgsBuilder.build(0.95e18, ORACLE_STALENESS, ORACLE_DECIMALS, CHAINLINK_ETH_USD)
            )
        );
    }

    /// @dev Chainlink-fair-bounded inventory skew branch. `premium` is the max taker-favorable
    ///      premium over fair value the LP tolerates (1e18); 0 == strict fair value.
    function _branchSkewBounded(address weth, uint64 k, uint64 premium) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.buildBounded(
                    k, SKEW_MAX, BASE_DECIMALS, QUOTE_DECIMALS, ORACLE_DECIMALS, ORACLE_STALENESS, weth, CHAINLINK_ETH_USD, premium
                )
            )
        );
    }

    /// @notice Two-branch desk: baseline + heal. XYC/ORACLE are UI reference only.
    function _selectorArgs(address weth) internal view returns (bytes memory) {
        bytes memory baseline = _branchSkewBounded(weth, SKEW_BASELINE_K, 0);
        bytes memory heal = _branchSkewBounded(weth, SKEW_K, LP_PREMIUM);
        return abi.encodePacked(
            SELECTOR_LAMBDA,
            uint8(2),
            uint16(baseline.length), baseline,
            uint16(heal.length), heal
        );
    }

    function _primeProgram(address selector, address weth) internal view returns (bytes memory) {
        bytes memory extructionArgs = abi.encodePacked(selector, _selectorArgs(weth));
        require(extructionArgs.length <= 255, "extruction args overflow");
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(Decay._decayXD, DecayArgsBuilder.build(DECAY_PERIOD)),
            p.build(Extruction._extruction, extructionArgs),
            p.build(Controls._salt, ControlsArgsBuilder.buildSalt(uint64(PROGRAM_SALT)))
        );
    }

    function _ship(Aqua aqua, AquaSwapVMRouter router, ISwapVM.Order memory order, address weth, address usdc) internal {
        bytes memory strategy = abi.encode(order);
        address[] memory tokens = new address[](2);
        tokens[0] = weth;
        tokens[1] = usdc;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BASE_BAL;
        amounts[1] = QUOTE_BAL;
        aqua.ship(address(router), strategy, tokens, amounts);
    }
}
// solhint-enable no-console
