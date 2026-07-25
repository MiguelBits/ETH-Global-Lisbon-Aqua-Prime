// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Test, Vm } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ISwapVM } from "../src/SwapVM.sol";
import { AquaPrimeSwapGateway } from "../src/apps/AquaPrimeSwapGateway.sol";
import { AquaPrimeProgramBuilder } from "../src/apps/AquaPrimeProgramBuilder.sol";
import { PrimeSelector } from "../src/apps/PrimeSelector.sol";
import { Extruction } from "../src/instructions/Extruction.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { Controls } from "../src/instructions/Controls.sol";
import { Decay, DecayArgsBuilder } from "../src/instructions/Decay.sol";
import { SkewPricer, SkewPricerValueArgsBuilder } from "../src/instructions/SkewPricer.sol";
import { TakerTraitsLib } from "../src/libs/TakerTraits.sol";
import { Program, ProgramBuilder } from "./utils/ProgramBuilder.sol";
import { MockChainlinkAggregator } from "./mocks/MockChainlinkAggregator.sol";

import { AquaSwapVMTest } from "./base/AquaSwapVMTest.sol";

contract AquaPrimeGatewayTest is AquaSwapVMTest {
    using ProgramBuilder for Program;

    PrimeSelector internal selector;
    AquaPrimeProgramBuilder internal programBuilder;
    MockChainlinkAggregator internal oracle;
    uint128 internal constant LAMBDA = 1e9;
    uint64 internal constant HEAL_K = 0.5e18;
    uint64 internal constant MAX_ADJ = 0.1e18;
    uint64 internal constant PREMIUM = 0.005e18;
    uint64 internal constant SALT = 42;
    uint16 internal constant DECAY_PERIOD = 300;

    function setUp() public override {
        super.setUp();
        selector = new PrimeSelector(address(aqua));
        programBuilder = new AquaPrimeProgramBuilder();
        oracle = new MockChainlinkAggregator(8, 3000e8);
    }

    function _buildSelectorArgs(uint64 healK) internal view returns (bytes memory) {
        bytes memory baseline = bytes.concat(
            ProgramBuilder.init(_opcodes()).build(XYCSwap._xycSwapXD),
            ProgramBuilder.init(_opcodes()).build(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.buildBounded(
                    0, MAX_ADJ, 18, 18, 8, 0, address(tokenA), address(oracle), 0
                )
            )
        );
        bytes memory heal = bytes.concat(
            ProgramBuilder.init(_opcodes()).build(XYCSwap._xycSwapXD),
            ProgramBuilder.init(_opcodes()).build(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.buildBounded(
                    healK, MAX_ADJ, 18, 18, 8, 0, address(tokenA), address(oracle), PREMIUM
                )
            )
        );
        return abi.encodePacked(LAMBDA, uint8(2), uint16(baseline.length), baseline, uint16(heal.length), heal);
    }

    function _primeProgram(uint64 healK) internal view returns (bytes memory) {
        bytes memory extructionArgs = abi.encodePacked(address(selector), _buildSelectorArgs(healK));
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(Decay._decayXD, DecayArgsBuilder.build(DECAY_PERIOD)),
            p.build(Extruction._extruction, extructionArgs),
            p.build(Controls._salt, abi.encodePacked(SALT))
        );
    }

    function _buildTakerData(address takerAddr) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: takerAddr,
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

    function _initialDesk() internal pure returns (AquaPrimeSwapGateway.DeskSet memory) {
        return AquaPrimeSwapGateway.DeskSet({
            healK: HEAL_K,
            maxAdjustment: MAX_ADJ,
            healPremium: PREMIUM,
            lambda: LAMBDA,
            deadline: type(uint64).max,
            attestation: bytes32(0)
        });
    }

    function _deployGateway() internal returns (AquaPrimeSwapGateway gw, ISwapVM.Order memory order) {
        order = createStrategy(_primeProgram(HEAL_K));
        bytes memory selArgs = _buildSelectorArgs(HEAL_K);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        AquaPrimeSwapGateway.GatewayConfig memory cfg = AquaPrimeSwapGateway.GatewayConfig({
            maker: maker,
            baseToken: address(tokenA),
            quoteToken: address(tokenB),
            oracle: address(oracle),
            baseDecimals: 18,
            quoteDecimals: 18,
            oracleDecimals: 8,
            maxStaleness: 0,
            decayPeriod: DECAY_PERIOD,
            initialSalt: SALT,
            initialDeskSet: _initialDesk()
        });
        gw = new AquaPrimeSwapGateway(
            aqua, swapVM, selector, programBuilder, cfg, order, _buildTakerData(predicted), selArgs
        );
        shipStrategy(order, tokenA, tokenB, 1_000e18, 3_000e18);
        tokenA.mint(maker, 1_000e18);
        tokenB.mint(maker, 3_000e18);
    }

    function _retune(AquaPrimeSwapGateway gw, AquaPrimeSwapGateway.DeskSet memory desk) internal {
        vm.prank(maker);
        (bytes32 oldHash, uint256 balBase, uint256 balQuote, bytes memory strategy) = gw.stageDeskSet(desk);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = balBase;
        amounts[1] = balQuote;

        vm.prank(maker);
        aqua.dock(address(swapVM), oldHash, tokens);
        vm.prank(maker);
        aqua.ship(address(swapVM), strategy, tokens, amounts);
        vm.prank(maker);
        gw.finalizeDeskSet();
    }

    function test_gateway_desk_shipped_event() public {
        (AquaPrimeSwapGateway gw, ISwapVM.Order memory order) = _deployGateway();

        vm.expectEmit(true, true, true, true);
        emit AquaPrimeSwapGateway.DeskShipped(
            maker, swapVM.hash(order), address(tokenA), address(tokenB), 1_000e18, 3_000e18, "maker.primedesk.eth"
        );
        vm.prank(maker);
        gw.recordDeskShipped(1_000e18, 3_000e18, "maker.primedesk.eth");
        assertTrue(gw.deskRecorded());
    }

    function test_gateway_quote_branch_breakdown() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        (uint256 primeOut, uint256[4] memory outs,,, uint8 winner) = gw.quoteBranchBreakdown(10e18, true);
        assertGt(primeOut, 0);
        assertGt(outs[winner], 0);
    }

    function test_gateway_swap_emits_swap_routed() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        uint256 amountIn = 10e18;
        tokenA.mint(address(taker), amountIn);
        vm.prank(address(taker));
        IERC20(address(tokenA)).approve(address(gw), amountIn);

        vm.recordLogs();
        vm.prank(address(taker));
        gw.swapExactIn(amountIn, true);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 routedTopic = keccak256(
            "SwapRouted(address,address,bool,uint256,uint256,uint8,uint256,uint256,uint256)"
        );
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == routedTopic) {
                found = true;
                break;
            }
        }
        assertTrue(found, "SwapRouted event missing");
    }

    function test_commit_desk_set_changes_quote_and_preserves_balances() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        uint256 beforeOut = gw.quoteExactIn(10e18, true);
        (uint256 b0, uint256 b1) = gw.virtualBalances();

        AquaPrimeSwapGateway.DeskSet memory next = AquaPrimeSwapGateway.DeskSet({
            healK: 0.8e18,
            maxAdjustment: MAX_ADJ,
            healPremium: 0.02e18,
            lambda: LAMBDA,
            deadline: uint64(block.timestamp + 1 hours),
            attestation: keccak256("0g-test")
        });
        _retune(gw, next);

        (uint256 a0, uint256 a1) = gw.virtualBalances();
        assertEq(a0, b0, "base bal");
        assertEq(a1, b1, "quote bal");
        (uint64 activeHealK,,,,,) = gw.activeDeskSet();
        assertEq(activeHealK, next.healK);
        // Quote may change with stronger heal; at minimum finalize succeeded and quote still works.
        uint256 afterOut = gw.quoteExactIn(10e18, true);
        assertGt(afterOut, 0);
        // On a quote-heavy book, higher healK should not reduce WETH→tokenB out vs prior heal.
        assertGe(afterOut, beforeOut);
    }

    function test_commit_desk_set_only_maker() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        AquaPrimeSwapGateway.DeskSet memory next = _initialDesk();
        next.deadline = uint64(block.timestamp + 1 hours);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayOnlyMaker.selector);
        gw.stageDeskSet(next);
    }

    function test_commit_desk_set_caps() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        AquaPrimeSwapGateway.DeskSet memory next = _initialDesk();
        next.deadline = uint64(block.timestamp + 1 hours);
        next.healK = 0.9e18; // > MAX_HEAL_K
        vm.prank(maker);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayDeskSetCaps.selector);
        gw.stageDeskSet(next);
    }

    function test_quote_matches_swap_after_commit() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        AquaPrimeSwapGateway.DeskSet memory next = AquaPrimeSwapGateway.DeskSet({
            healK: 0.7e18,
            maxAdjustment: MAX_ADJ,
            healPremium: PREMIUM,
            lambda: LAMBDA,
            deadline: uint64(block.timestamp + 1 hours),
            attestation: bytes32(0)
        });
        _retune(gw, next);

        uint256 amountIn = 5e18;
        uint256 quoted = gw.quoteExactIn(amountIn, true);
        tokenA.mint(address(taker), amountIn);
        vm.prank(address(taker));
        IERC20(address(tokenA)).approve(address(gw), amountIn);
        vm.prank(address(taker));
        (, uint256 amountOut) = gw.swapExactIn(amountIn, true);
        assertEq(amountOut, quoted);
    }

    // ===== settlement: both sides of the trade =====

    function test_gateway_swap_settles_both_sides() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        uint256 amountIn = 10e18;
        tokenA.mint(address(taker), amountIn);
        vm.prank(address(taker));
        IERC20(address(tokenA)).approve(address(gw), amountIn);

        (uint256 baseBefore, uint256 quoteBefore) = gw.virtualBalances();
        uint256 takerABefore = tokenA.balanceOf(address(taker));
        uint256 takerBBefore = tokenB.balanceOf(address(taker));

        vm.prank(address(taker));
        (uint256 actualIn, uint256 amountOut) = gw.swapExactIn(amountIn, true);
        assertGt(amountOut, 0, "swap produced no output");

        // Taker side: tokenA down by actualIn, tokenB up by amountOut (gateway forwards proceeds).
        assertEq(tokenA.balanceOf(address(taker)), takerABefore - actualIn, "taker tokenA delta");
        assertEq(tokenB.balanceOf(address(taker)), takerBBefore + amountOut, "taker tokenB delta");
        // Gateway must hold no residue.
        assertEq(tokenA.balanceOf(address(gw)), 0, "gateway stuck tokenA");
        assertEq(tokenB.balanceOf(address(gw)), 0, "gateway stuck tokenB");
        // Maker book: base grows by actualIn, quote shrinks by amountOut.
        (uint256 baseAfter, uint256 quoteAfter) = gw.virtualBalances();
        assertEq(baseAfter, baseBefore + actualIn, "book base delta");
        assertEq(quoteAfter, quoteBefore - amountOut, "book quote delta");
    }

    // ===== desk-set lifecycle reverts =====

    function test_reverts_stage_desk_set_expired_deadline() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        vm.warp(1_000_000);
        AquaPrimeSwapGateway.DeskSet memory next = _initialDesk();
        next.deadline = uint64(block.timestamp - 1);
        vm.prank(maker);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayDeskSetExpired.selector);
        gw.stageDeskSet(next);
    }

    function test_reverts_stage_desk_set_lambda_caps() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        AquaPrimeSwapGateway.DeskSet memory next = _initialDesk();
        next.deadline = uint64(block.timestamp + 1 hours);

        next.lambda = gw.MIN_LAMBDA() - 1;
        vm.prank(maker);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayDeskSetCaps.selector);
        gw.stageDeskSet(next);

        next.lambda = gw.MAX_LAMBDA() + 1;
        vm.prank(maker);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayDeskSetCaps.selector);
        gw.stageDeskSet(next);
    }

    function test_reverts_stage_desk_set_while_pending() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        AquaPrimeSwapGateway.DeskSet memory next = _initialDesk();
        next.deadline = uint64(block.timestamp + 1 hours);
        vm.prank(maker);
        gw.stageDeskSet(next);

        vm.prank(maker);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayPendingDeskSet.selector);
        gw.stageDeskSet(next);
    }

    function test_reverts_swap_while_pending_desk_set() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        AquaPrimeSwapGateway.DeskSet memory next = _initialDesk();
        next.deadline = uint64(block.timestamp + 1 hours);
        vm.prank(maker);
        gw.stageDeskSet(next);

        vm.prank(address(taker));
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayPendingDeskSet.selector);
        gw.swapExactIn(1e18, true);
    }

    function test_reverts_finalize_without_pending() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        vm.prank(maker);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayNoPendingDeskSet.selector);
        gw.finalizeDeskSet();
    }

    function test_reverts_finalize_before_ship() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        AquaPrimeSwapGateway.DeskSet memory next = _initialDesk();
        next.deadline = uint64(block.timestamp + 1 hours);
        vm.prank(maker);
        gw.stageDeskSet(next);

        // Maker has not docked/shipped the pending strategy on Aqua yet.
        vm.prank(maker);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayPendingNotShipped.selector);
        gw.finalizeDeskSet();
    }

    function test_reverts_finalize_only_maker() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayOnlyMaker.selector);
        gw.finalizeDeskSet();
    }

    // ===== registration + callback guards =====

    function test_reverts_record_desk_shipped_twice() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        vm.prank(maker);
        gw.recordDeskShipped(1_000e18, 3_000e18, "maker.primedesk.eth");
        vm.prank(maker);
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayDeskAlreadyRecorded.selector);
        gw.recordDeskShipped(1_000e18, 3_000e18, "maker.primedesk.eth");
    }

    function test_reverts_record_desk_shipped_only_maker() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayOnlyMaker.selector);
        gw.recordDeskShipped(1, 1, "x");
    }

    function test_reverts_pre_transfer_in_callback_not_router() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        vm.expectRevert(AquaPrimeSwapGateway.AquaPrimeGatewayNotSwapVM.selector);
        gw.preTransferInCallback(maker, address(0), address(tokenA), address(tokenB), 1, 0, bytes32(0), "");
    }

    // ===== events carry the 0G attestation =====

    function test_stage_and_finalize_emit_desk_set_events() public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        bytes32 attestation = keccak256("0g-inference-proof");
        AquaPrimeSwapGateway.DeskSet memory next = AquaPrimeSwapGateway.DeskSet({
            healK: 0.6e18,
            maxAdjustment: MAX_ADJ,
            healPremium: 0.01e18,
            lambda: LAMBDA,
            deadline: uint64(block.timestamp + 1 hours),
            attestation: attestation
        });

        // Pending strategy hash is unknown before staging — skip topic3, check data payload.
        vm.expectEmit(true, true, false, true);
        emit AquaPrimeSwapGateway.DeskSetStaged(
            maker, gw.strategyHash(), bytes32(0), 1_000e18, 3_000e18,
            next.healK, next.maxAdjustment, next.healPremium, next.lambda, attestation
        );
        vm.prank(maker);
        (bytes32 oldHash, uint256 balBase, uint256 balQuote, bytes memory strategy) = gw.stageDeskSet(next);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = balBase;
        amounts[1] = balQuote;
        vm.prank(maker);
        aqua.dock(address(swapVM), oldHash, tokens);
        vm.prank(maker);
        aqua.ship(address(swapVM), strategy, tokens, amounts);

        vm.expectEmit(true, true, true, true);
        emit AquaPrimeSwapGateway.DeskSetCommitted(
            maker, gw.pendingStrategyHash(),
            next.healK, next.maxAdjustment, next.healPremium, next.lambda, attestation
        );
        vm.prank(maker);
        gw.finalizeDeskSet();

        (,,,,, bytes32 activeAttestation) = gw.activeDeskSet();
        assertEq(activeAttestation, attestation, "attestation persisted");
    }

    // ===== fuzz: quote == swap across the whole legal desk-set space =====

    function testFuzz_desk_set_quote_matches_swap(
        uint64 healK,
        uint64 maxAdjustment,
        uint64 healPremium,
        uint128 lambda,
        uint96 rawAmountIn
    ) public {
        (AquaPrimeSwapGateway gw,) = _deployGateway();
        healK = uint64(bound(healK, 0, gw.MAX_HEAL_K()));
        maxAdjustment = uint64(bound(maxAdjustment, 0, gw.MAX_ADJUSTMENT()));
        healPremium = uint64(bound(healPremium, 0, gw.MAX_HEAL_PREMIUM()));
        lambda = uint128(bound(lambda, gw.MIN_LAMBDA(), gw.MAX_LAMBDA()));
        uint256 amountIn = bound(uint256(rawAmountIn), 1e15, 50e18);

        AquaPrimeSwapGateway.DeskSet memory next = AquaPrimeSwapGateway.DeskSet({
            healK: healK,
            maxAdjustment: maxAdjustment,
            healPremium: healPremium,
            lambda: lambda,
            deadline: uint64(block.timestamp + 1 hours),
            attestation: bytes32(0)
        });
        _retune(gw, next);

        uint256 quoted = gw.quoteExactIn(amountIn, true);
        tokenA.mint(address(taker), amountIn);
        vm.prank(address(taker));
        IERC20(address(tokenA)).approve(address(gw), amountIn);
        vm.prank(address(taker));
        (, uint256 amountOut) = gw.swapExactIn(amountIn, true);
        assertEq(amountOut, quoted, "quote == swap under fuzzed desk set");
    }

    /// @notice Desk bytecode must lead with `_decayXD` (Mooniswap-style MEV shield wraps extruction).
    function test_buildDesk_program_starts_with_decay() public view {
        (, bytes memory program) = programBuilder.buildDesk(
            address(selector),
            LAMBDA,
            HEAL_K,
            MAX_ADJ,
            PREMIUM,
            SALT,
            address(tokenA),
            address(oracle),
            18,
            18,
            8,
            0,
            DECAY_PERIOD
        );
        uint8 decayOpcode = ProgramBuilder.findOpcode(
            ProgramBuilder.init(_opcodes()),
            Decay._decayXD
        );
        assertEq(uint8(program[0]), decayOpcode, "desk program must start with _decayXD");
        assertEq(uint8(program[1]), 2, "decay args length is uint16 period");
    }

    /// @notice Aqua + `_decayXD` + XYC: reverse fill improves after the decay period (1inch MEV shield).
    function test_decay_aqua_reverse_improves_after_period() public {
        Program memory p = ProgramBuilder.init(_opcodes());
        bytes memory program = bytes.concat(
            p.build(Decay._decayXD, DecayArgsBuilder.build(DECAY_PERIOD)),
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(uint64(99)))
        );
        ISwapVM.Order memory order = createStrategy(program);
        shipStrategy(order, tokenA, tokenB, 1_000e18, 1_000e18);

        SwapProgram memory forward = SwapProgram({
            amount: 100e18,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: true
        });
        mintTokenInToTaker(forward, 100e18);
        mintTokenOutToMaker(forward, 1_000e18);
        swap(forward, order);

        SwapProgram memory reverse = SwapProgram({
            amount: 50e18,
            taker: taker2,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: false,
            isExactIn: true
        });

        (, uint256 outImmediate) = quote(reverse, order);
        vm.warp(block.timestamp + uint256(DECAY_PERIOD) + 1);
        (, uint256 outAfterDecay) = quote(reverse, order);

        assertLt(outImmediate, outAfterDecay, "reverse must improve after full decay period");
    }
}
