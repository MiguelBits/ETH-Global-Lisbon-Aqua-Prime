// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Test } from "forge-std/Test.sol";

import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { SwapVM, ISwapVM } from "../src/SwapVM.sol";
import { AquaSwapVMRouter } from "../src/routers/AquaSwapVMRouter.sol";
import { MakerTraitsLib } from "../src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "../src/libs/TakerTraits.sol";
import { Controls, ControlsArgsBuilder } from "../src/instructions/Controls.sol";
import { XYCSwap } from "../src/instructions/XYCSwap.sol";
import { SolvencyGuard, SolvencyGuardArgsBuilder } from "../src/instructions/SolvencyGuard.sol";
import { AquaOpcodesDebug } from "../src/opcodes/AquaOpcodesDebug.sol";
import { WellspringVault } from "../src/apps/WellspringVault.sol";
import { IAaveV3Pool } from "../src/adapters/AaveSolvencyLens.sol";
import { MockLendingPool } from "../src/mocks/MockLendingPool.sol";
import { MockTaker } from "./mocks/MockTaker.sol";
import { Program, ProgramBuilder } from "./utils/ProgramBuilder.sol";

contract WellspringTest is Test, AquaOpcodesDebug {
    using ProgramBuilder for Program;

    Aqua public immutable aqua = new Aqua();

    uint256 internal constant BALANCE_A = 1000e18;
    uint256 internal constant BALANCE_B = 2000e18;

    SwapVM public swapVM;
    WellspringVault public vault;
    MockLendingPool public poolA;
    MockLendingPool public poolB;
    MockTaker public taker;

    TokenMock public tokenA;
    TokenMock public tokenB;

    constructor() AquaOpcodesDebug(address(aqua)) {}

    function setUp() public {
        swapVM = new AquaSwapVMRouter(address(aqua), address(0), address(this), "Wellspring", "1.0.0");
        vault = new WellspringVault(aqua, swapVM, IAaveV3Pool(address(0)));

        tokenA = new TokenMock("Token A", "TKA");
        tokenB = new TokenMock("Token B", "TKB");

        poolA = new MockLendingPool(tokenA, "aTKA", "aTKA");
        poolB = new MockLendingPool(tokenB, "aTKB", "aTKB");

        vault.registerPool(address(tokenA), poolA);
        vault.registerPool(address(tokenB), poolB);

        taker = new MockTaker(aqua, swapVM, address(this));

        tokenA.mint(address(this), BALANCE_A);
        tokenA.approve(address(vault), BALANCE_A);
        vault.deposit(address(tokenA), BALANCE_A);

        vm.prank(address(taker));
        tokenB.approve(address(swapVM), type(uint256).max);
    }

    function _buildProgram() internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(XYCSwap._xycSwapXD),
            p.build(SolvencyGuard._solvencyGuard, SolvencyGuardArgsBuilder.build(address(poolA))),
            p.build(Controls._salt, ControlsArgsBuilder.buildSalt(uint64(0xBEEF)))
        );
    }

    function _createOrder() internal view returns (ISwapVM.Order memory order) {
        order = MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: address(vault),
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: true,
            hasPreTransferOutHook: true,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: _buildProgram()
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

    function test_zero_idle_swap_from_lending() public {
        ISwapVM.Order memory order = _createOrder();
        bytes32 strategyHash = vault.ship(order, address(tokenA), address(tokenB), BALANCE_A, BALANCE_B);
        assertEq(strategyHash, swapVM.hash(order));

        assertEq(tokenA.balanceOf(address(vault)), 0, "maker wallet should hold zero idle tokenA");
        assertEq(poolA.withdrawable(address(vault)), BALANCE_A, "all tokenA should sit in lending");

        uint256 swapAmountIn = 100e18;
        tokenB.mint(address(taker), swapAmountIn);

        uint256 aTokenABefore = poolA.withdrawable(address(vault));
        uint256 aTokenBBefore = poolB.withdrawable(address(vault));

        (uint256 amountIn, uint256 amountOut) = taker.swap(
            order,
            address(tokenB),
            address(tokenA),
            swapAmountIn,
            _takerData()
        );

        assertGt(amountIn, 0);
        assertGt(amountOut, 0);
        assertEq(tokenA.balanceOf(address(vault)), 0, "tokenA should not idle in wallet after swap");
        assertEq(poolA.withdrawable(address(vault)), aTokenABefore - amountOut, "tokenA lending should drop by amountOut");
        assertEq(poolB.withdrawable(address(vault)), aTokenBBefore + amountIn, "tokenB proceeds should be re-supplied");

        (uint256 balanceA, uint256 balanceB) = aqua.safeBalances(address(vault), address(swapVM), strategyHash, address(tokenA), address(tokenB));
        assertEq(balanceA, BALANCE_A - amountOut, "virtual tokenA should decrease by amountOut");
        assertEq(balanceB, BALANCE_B + amountIn, "virtual tokenB should increase by amountIn");
    }

    function test_quote_matches_swap() public {
        ISwapVM.Order memory order = _createOrder();
        vault.ship(order, address(tokenA), address(tokenB), BALANCE_A, BALANCE_B);

        uint256 swapAmountIn = 50e18;
        tokenB.mint(address(taker), swapAmountIn);

        (uint256 quoteIn, uint256 quoteOut,) = swapVM.asView().quote(
            order,
            address(tokenB),
            address(tokenA),
            swapAmountIn,
            _takerData()
        );

        (uint256 amountIn, uint256 amountOut) = taker.swap(
            order,
            address(tokenB),
            address(tokenA),
            swapAmountIn,
            _takerData()
        );

        assertEq(amountIn, quoteIn);
        assertEq(amountOut, quoteOut);
    }

    function test_solvency_guard_blocks_overcommit() public {
        ISwapVM.Order memory order = _createOrder();
        uint256 virtualBalanceA = BALANCE_A * 5;
        vault.ship(order, address(tokenA), address(tokenB), virtualBalanceA, BALANCE_B);

        uint256 swapAmountIn = 600e18;
        tokenB.mint(address(taker), swapAmountIn);

        uint256 expectedAmountOut = virtualBalanceA * swapAmountIn / (BALANCE_B + swapAmountIn);

        vm.expectRevert(
            abi.encodeWithSelector(
                SolvencyGuard.InsufficientProducibleLiquidity.selector,
                address(vault),
                address(tokenA),
                uint256(0),
                BALANCE_A,
                expectedAmountOut
            )
        );
        taker.swap(order, address(tokenB), address(tokenA), swapAmountIn, _takerData());
    }
}
