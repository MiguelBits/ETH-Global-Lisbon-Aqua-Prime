// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@1inch/solidity-utils/contracts/libraries/SafeERC20.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { SwapVM, ISwapVM } from "../SwapVM.sol";
import { ITakerCallbacks } from "../interfaces/ITakerCallbacks.sol";
import { SwapQuery, SwapRegisters } from "../libs/VM.sol";
import { MakerTraitsLib } from "../libs/MakerTraits.sol";
import { PrimeSelector } from "./PrimeSelector.sol";
import { AquaPrimeProgramBuilder } from "./AquaPrimeProgramBuilder.sol";

/// @title AquaPrimeSwapGateway
/// @notice Prime Desk UI entrypoint: quote + swap on a BASE/QUOTE Aqua Prime strategy.
/// @dev Desk knobs are retuned via stageDeskSet → maker Aqua.dock/ship → finalizeDeskSet
///      (Aqua dock/ship require msg.sender == maker, so they cannot be called inside this contract).
contract AquaPrimeSwapGateway is ITakerCallbacks {
    using SafeERC20 for IERC20;

    uint64 public constant MAX_HEAL_K = 0.8e18;
    uint64 public constant MAX_ADJUSTMENT = 0.1e18;
    uint64 public constant MAX_HEAL_PREMIUM = 0.02e18;
    uint128 public constant MIN_LAMBDA = 5e8;
    uint128 public constant MAX_LAMBDA = 5e9;

    error AquaPrimeGatewayNotSwapVM();
    error AquaPrimeGatewayDeskAlreadyRecorded();
    error AquaPrimeGatewayOnlyMaker();
    error AquaPrimeGatewayDeskSetExpired();
    error AquaPrimeGatewayDeskSetCaps();
    error AquaPrimeGatewayNoPendingDeskSet();
    error AquaPrimeGatewayPendingDeskSet();
    error AquaPrimeGatewayPendingNotShipped();
    /// @dev Pending retune exists but old strategy was already docked — must ship+finalize, cannot abandon.
    error AquaPrimeGatewayMustFinishPendingShip();

    struct DeskSet {
        uint64 healK;
        uint64 maxAdjustment;
        uint64 healPremium;
        uint128 lambda;
        uint64 deadline;
        bytes32 attestation;
    }

    struct GatewayConfig {
        address maker;
        address baseToken;
        address quoteToken;
        address oracle;
        uint8 baseDecimals;
        uint8 quoteDecimals;
        uint8 oracleDecimals;
        uint16 maxStaleness;
        /// @dev `_decayXD` period in seconds (Mooniswap-style virtual reserve fade).
        uint16 decayPeriod;
        uint64 initialSalt;
        DeskSet initialDeskSet;
    }

    /// @notice Emitted once when the maker records the initial desk ship.
    event DeskShipped(
        address indexed maker,
        bytes32 indexed strategyHash,
        address indexed baseToken,
        address quoteToken,
        uint256 baseBal,
        uint256 quoteBal,
        string ensName
    );

    /// @notice Emitted when a desk set is staged (awaiting maker dock/ship).
    event DeskSetStaged(
        address indexed maker,
        bytes32 indexed oldStrategyHash,
        bytes32 indexed pendingStrategyHash,
        uint256 balBase,
        uint256 balQuote,
        uint64 healK,
        uint64 maxAdjustment,
        uint64 healPremium,
        uint128 lambda,
        bytes32 attestation
    );

    /// @notice Emitted when staged desk set is activated after Aqua ship.
    event DeskSetCommitted(
        address indexed maker,
        bytes32 indexed strategyHash,
        uint64 healK,
        uint64 maxAdjustment,
        uint64 healPremium,
        uint128 lambda,
        bytes32 attestation
    );

    /// @notice Emitted on every routed swap.
    event SwapRouted(
        address indexed maker,
        address indexed taker,
        bool sellBase,
        uint256 amountIn,
        uint256 amountOut,
        uint8 winnerIndex,
        uint256 postSkewE18,
        uint256 baseBalAfter,
        uint256 quoteBalAfter
    );

    Aqua public immutable AQUA;
    SwapVM public immutable ROUTER;
    PrimeSelector public immutable SELECTOR;
    AquaPrimeProgramBuilder public immutable PROGRAM_BUILDER;
    address public immutable MAKER;
    address public immutable BASE;
    address public immutable QUOTE;
    address public immutable ORACLE;
    uint8 public immutable BASE_DECIMALS;
    uint8 public immutable QUOTE_DECIMALS;
    uint8 public immutable ORACLE_DECIMALS;
    uint16 public immutable MAX_STALENESS;
    /// @notice SwapVM `_decayXD` period (seconds) baked into every desk program.
    uint16 public immutable DECAY_PERIOD;

    /// @notice Active Aqua strategy hash (mutable across desk retunes).
    bytes32 public strategyHash;
    /// @notice Backward-compatible getter name used by the scaffold ABI.
    function STRATEGY_HASH() external view returns (bytes32) {
        return strategyHash;
    }

    bytes internal _takerData;
    bytes internal _selectorArgs;
    ISwapVM.Order internal _order;
    bool public deskRecorded;

    DeskSet public activeDeskSet;
    uint64 public programSalt;

    // Pending retune (after stage, before finalize)
    bool public hasPendingDeskSet;
    DeskSet internal _pendingDeskSet;
    ISwapVM.Order internal _pendingOrder;
    bytes internal _pendingSelectorArgs;
    bytes32 public pendingStrategyHash;
    uint256 public pendingBalBase;
    uint256 public pendingBalQuote;

    constructor(
        Aqua aqua,
        SwapVM router,
        PrimeSelector selector,
        AquaPrimeProgramBuilder programBuilder,
        GatewayConfig memory cfg,
        ISwapVM.Order memory order,
        bytes memory takerData,
        bytes memory selectorArgs
    ) {
        AQUA = aqua;
        ROUTER = router;
        SELECTOR = selector;
        PROGRAM_BUILDER = programBuilder;
        MAKER = cfg.maker;
        BASE = cfg.baseToken;
        QUOTE = cfg.quoteToken;
        ORACLE = cfg.oracle;
        BASE_DECIMALS = cfg.baseDecimals;
        QUOTE_DECIMALS = cfg.quoteDecimals;
        ORACLE_DECIMALS = cfg.oracleDecimals;
        MAX_STALENESS = cfg.maxStaleness;
        DECAY_PERIOD = cfg.decayPeriod;
        _order = order;
        _takerData = takerData;
        _selectorArgs = selectorArgs;
        strategyHash = router.hash(order);
        activeDeskSet = cfg.initialDeskSet;
        programSalt = cfg.initialSalt;
    }

    /// @param sellBase true = BASE→QUOTE (e.g. WETH→USDC), false = QUOTE→BASE
    function quoteExactIn(uint256 amountIn, bool sellBase) public view returns (uint256 amountOut) {
        (address tokenIn, address tokenOut) = _path(sellBase);
        (, amountOut,) = ROUTER.asView().quote(_order, tokenIn, tokenOut, amountIn, _takerData);
    }

    function quoteBaseToQuote(uint256 amountIn) external view returns (uint256 amountOut) {
        return quoteExactIn(amountIn, true);
    }

    function quoteQuoteToBase(uint256 amountIn) external view returns (uint256 amountOut) {
        return quoteExactIn(amountIn, false);
    }

    /// @notice Score all PrimeSelector branches on the live virtual book (for UI routing panel).
    function quoteBranchBreakdown(uint256 amountIn, bool sellBase)
        external
        returns (
            uint256 primeOut,
            uint256[4] memory branchOuts,
            int256[4] memory scores,
            uint256[4] memory postSkewE18,
            uint8 winnerIndex
        )
    {
        primeOut = quoteExactIn(amountIn, sellBase);
        (uint256 balBase, uint256 balQuote) = virtualBalances();
        (address tokenIn, address tokenOut) = _path(sellBase);

        SwapQuery memory query = SwapQuery({
            orderHash: strategyHash,
            maker: MAKER,
            taker: address(this),
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            isExactIn: true
        });
        SwapRegisters memory swap = SwapRegisters({
            balanceIn: tokenIn == BASE ? balBase : balQuote,
            balanceOut: tokenOut == BASE ? balBase : balQuote,
            amountIn: amountIn,
            amountOut: 0,
            amountNetPulled: 0
        });

        (PrimeSelector.BranchResult[] memory results, uint8 win) =
            SELECTOR.simulateBranches(query, swap, _selectorArgs, _takerData);
        winnerIndex = win;

        for (uint256 i = 0; i < 4 && i < results.length; i++) {
            branchOuts[i] = results[i].amountOut;
            scores[i] = results[i].score;
            postSkewE18[i] = results[i].postSkewE18;
        }
    }

    function swapExactIn(uint256 amountIn, bool sellBase) external returns (uint256 actualIn, uint256 amountOut) {
        return _swapExactIn(amountIn, sellBase);
    }

    function swapBaseForQuote(uint256 amountIn) external returns (uint256 actualIn, uint256 amountOut) {
        return _swapExactIn(amountIn, true);
    }

    function swapQuoteForBase(uint256 amountIn) external returns (uint256 actualIn, uint256 amountOut) {
        return _swapExactIn(amountIn, false);
    }

    function virtualBalances() public view returns (uint256 balBase, uint256 balQuote) {
        return AQUA.safeBalances(MAKER, address(ROUTER), strategyHash, BASE, QUOTE);
    }

    /// @notice Stage a desk retune. Maker must Aqua.dock(old) + ship(pending) then finalizeDeskSet.
    function stageDeskSet(DeskSet calldata s)
        external
        returns (bytes32 oldHash, uint256 balBase, uint256 balQuote, bytes memory strategy)
    {
        if (msg.sender != MAKER) revert AquaPrimeGatewayOnlyMaker();
        if (hasPendingDeskSet) revert AquaPrimeGatewayPendingDeskSet();
        if (block.timestamp > s.deadline) revert AquaPrimeGatewayDeskSetExpired();
        _validateDeskSet(s);

        oldHash = strategyHash;
        (balBase, balQuote) = virtualBalances();

        uint64 nextSalt = programSalt + 1;
        (bytes memory selectorArgs, bytes memory program) = PROGRAM_BUILDER.buildDesk(
            address(SELECTOR),
            s.lambda,
            s.healK,
            s.maxAdjustment,
            s.healPremium,
            nextSalt,
            BASE,
            ORACLE,
            BASE_DECIMALS,
            QUOTE_DECIMALS,
            ORACLE_DECIMALS,
            MAX_STALENESS,
            DECAY_PERIOD
        );

        ISwapVM.Order memory newOrder = MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: MAKER,
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
            })
        );

        _pendingOrder = newOrder;
        _pendingSelectorArgs = selectorArgs;
        _pendingDeskSet = s;
        pendingStrategyHash = ROUTER.hash(newOrder);
        pendingBalBase = balBase;
        pendingBalQuote = balQuote;
        hasPendingDeskSet = true;
        programSalt = nextSalt;
        strategy = abi.encode(newOrder);

        emit DeskSetStaged(
            MAKER,
            oldHash,
            pendingStrategyHash,
            balBase,
            balQuote,
            s.healK,
            s.maxAdjustment,
            s.healPremium,
            s.lambda,
            s.attestation
        );
    }

    /// @notice Activate staged desk set after maker has shipped the pending strategy on Aqua.
    function finalizeDeskSet() external {
        if (msg.sender != MAKER) revert AquaPrimeGatewayOnlyMaker();
        if (!hasPendingDeskSet) revert AquaPrimeGatewayNoPendingDeskSet();

        // Revert if pending strategy is not active on Aqua yet.
        try AQUA.safeBalances(MAKER, address(ROUTER), pendingStrategyHash, BASE, QUOTE) returns (uint256, uint256) {
            // ok
        } catch {
            revert AquaPrimeGatewayPendingNotShipped();
        }

        _order = _pendingOrder;
        _selectorArgs = _pendingSelectorArgs;
        strategyHash = pendingStrategyHash;
        activeDeskSet = _pendingDeskSet;

        DeskSet memory committed = _pendingDeskSet;
        hasPendingDeskSet = false;
        pendingStrategyHash = bytes32(0);
        pendingBalBase = 0;
        pendingBalQuote = 0;
        delete _pendingOrder;
        delete _pendingSelectorArgs;

        emit DeskSetCommitted(
            MAKER,
            strategyHash,
            committed.healK,
            committed.maxAdjustment,
            committed.healPremium,
            committed.lambda,
            committed.attestation
        );
    }

    /// @notice Drop a staged retune when the prior strategy is still live on Aqua (dock not yet done).
    /// @dev If dock already ran, this reverts — finish ship + finalize (or redeploy the fork) instead.
    function abandonPendingDeskSet() external {
        if (msg.sender != MAKER) revert AquaPrimeGatewayOnlyMaker();
        if (!hasPendingDeskSet) revert AquaPrimeGatewayNoPendingDeskSet();

        try AQUA.safeBalances(MAKER, address(ROUTER), strategyHash, BASE, QUOTE) returns (uint256, uint256) {
            // prior strategy still active — safe to drop pending
        } catch {
            revert AquaPrimeGatewayMustFinishPendingShip();
        }

        hasPendingDeskSet = false;
        pendingStrategyHash = bytes32(0);
        pendingBalBase = 0;
        pendingBalQuote = 0;
        delete _pendingOrder;
        delete _pendingSelectorArgs;
        delete _pendingDeskSet;
    }

    /// @notice Encoded pending strategy for Aqua.ship (empty if none).
    function pendingStrategy() external view returns (bytes memory) {
        if (!hasPendingDeskSet) return "";
        return abi.encode(_pendingOrder);
    }

    /// @notice One-time desk registration (callable by maker after ship).
    function recordDeskShipped(uint256 baseBal, uint256 quoteBal, string calldata ensName) external {
        if (msg.sender != MAKER) revert AquaPrimeGatewayOnlyMaker();
        if (deskRecorded) revert AquaPrimeGatewayDeskAlreadyRecorded();
        deskRecorded = true;
        emit DeskShipped(MAKER, strategyHash, BASE, QUOTE, baseBal, quoteBal, ensName);
    }

    function preTransferInCallback(
        address maker,
        address,
        address tokenIn,
        address,
        uint256 amountIn,
        uint256,
        bytes32 orderHash,
        bytes calldata
    ) external override {
        if (msg.sender != address(ROUTER)) revert AquaPrimeGatewayNotSwapVM();
        maker;
        orderHash;
        IERC20(tokenIn).forceApprove(address(AQUA), amountIn);
        AQUA.push(maker, address(ROUTER), orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(
        address,
        address,
        address,
        address,
        uint256,
        uint256,
        bytes32,
        bytes calldata
    ) external pure override {
        // no-op
    }

    function _validateDeskSet(DeskSet calldata s) internal pure {
        if (s.healK > MAX_HEAL_K || s.maxAdjustment > MAX_ADJUSTMENT || s.healPremium > MAX_HEAL_PREMIUM) {
            revert AquaPrimeGatewayDeskSetCaps();
        }
        if (s.lambda < MIN_LAMBDA || s.lambda > MAX_LAMBDA) revert AquaPrimeGatewayDeskSetCaps();
        if (s.maxAdjustment >= 1e18) revert AquaPrimeGatewayDeskSetCaps();
    }

    function _path(bool sellBase) internal view returns (address tokenIn, address tokenOut) {
        tokenIn = sellBase ? BASE : QUOTE;
        tokenOut = sellBase ? QUOTE : BASE;
    }

    function _swapExactIn(uint256 amountIn, bool sellBase) internal returns (uint256 actualIn, uint256 amountOut) {
        if (hasPendingDeskSet) revert AquaPrimeGatewayPendingDeskSet();
        (address tokenIn, address tokenOut) = _path(sellBase);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        (actualIn, amountOut,) = ROUTER.swap(_order, tokenIn, tokenOut, amountIn, _takerData);
        // TakerData carries no `to` override, so SwapVM pays tokenOut to this gateway
        // (the router's msg.sender). Forward proceeds and refund any unpulled input.
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        if (actualIn < amountIn) {
            IERC20(tokenIn).safeTransfer(msg.sender, amountIn - actualIn);
        }
        (uint8 winnerIndex, uint256 postSkew) = SELECTOR.lastRoute();

        (uint256 baseAfter, uint256 quoteAfter) = virtualBalances();
        emit SwapRouted(MAKER, msg.sender, sellBase, actualIn, amountOut, winnerIndex, postSkew, baseAfter, quoteAfter);
    }
}
