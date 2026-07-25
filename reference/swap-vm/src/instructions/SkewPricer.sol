// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { Calldata } from "@1inch/solidity-utils/contracts/libraries/Calldata.sol";
import { Context } from "../libs/VM.sol";
import { IPriceOracle } from "./interfaces/IPriceOracle.sol";

/// @dev Fixed-point scale used by the skew math (1e18 == price multiplier of 1.0)
uint256 constant SKEW_ONE = 1e18;

library SkewPricerArgsBuilder {
    using Calldata for bytes;

    error SkewPricerMaxAdjustmentShouldBeLessThanOneE18(uint64 maxAdjustment);
    error SkewPricerMissingKArg();
    error SkewPricerMissingMaxAdjArg();

    /// @param k Skew sensitivity coefficient (1e18 scale), e.g. 0.1e18 shades ~10% of the raw skew
    /// @param maxAdjustment Hard cap on the price multiplier deviation (1e18 scale), e.g. 0.02e18 == ±2%
    function build(uint64 k, uint64 maxAdjustment) internal pure returns (bytes memory) {
        // A cap of >=1e18 would let the input-side multiplier (1e18 - maxAdjustment) reach zero.
        require(maxAdjustment < SKEW_ONE, SkewPricerMaxAdjustmentShouldBeLessThanOneE18(maxAdjustment));
        return abi.encodePacked(k, maxAdjustment);
    }

    function parse(bytes calldata args) internal pure returns (uint64 k, uint64 maxAdjustment) {
        k = uint64(bytes8(args.slice(0, 8, SkewPricerMissingKArg.selector)));
        maxAdjustment = uint64(bytes8(args.slice(8, 16, SkewPricerMissingMaxAdjArg.selector)));
    }
}

/// @dev Extended args for USD-normalized skew on mixed-decimal pairs (e.g. WETH/USDC).
library SkewPricerValueArgsBuilder {
    using Calldata for bytes;

    error SkewPricerValueMaxAdjustmentShouldBeLessThanOneE18(uint64 maxAdjustment);
    error SkewPricerValueMissingKArg();
    error SkewPricerValueMissingMaxAdjArg();
    error SkewPricerValueMissingBaseDecimalsArg();
    error SkewPricerValueMissingQuoteDecimalsArg();
    error SkewPricerValueMissingOracleDecimalsArg();
    error SkewPricerValueMissingMaxStalenessArg();
    error SkewPricerValueMissingBaseTokenArg();
    error SkewPricerValueMissingOracleAddressArg();
    error SkewPricerValueMissingMaxLpPremiumArg();
    error SkewPricerValueOraclePriceStale(uint256 currentTime, uint256 updatedAt, uint16 maxStaleness);

    /// @dev Byte length of the base (unbounded) value-skew args. A longer blob opts into the
    ///      Chainlink LP-protection cap by appending an 8-byte `maxLpPremium` field at the end.
    uint256 internal constant UNBOUNDED_ARGS_LEN = 61;
    uint256 internal constant BOUNDED_ARGS_LEN = 69;

    function build(
        uint64 k,
        uint64 maxAdjustment,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        uint8 oracleDecimals,
        uint16 maxStaleness,
        address baseToken,
        address oracleAddress
    ) internal pure returns (bytes memory) {
        require(maxAdjustment < SKEW_ONE, SkewPricerValueMaxAdjustmentShouldBeLessThanOneE18(maxAdjustment));
        return abi.encodePacked(
            k,
            maxAdjustment,
            baseDecimals,
            quoteDecimals,
            oracleDecimals,
            maxStaleness,
            baseToken,
            oracleAddress
        );
    }

    /// @notice Bounded variant: identical layout to {build} plus a trailing `maxLpPremium` field.
    /// @dev The presence of the extra field switches on the fair-value cap in `_skewPricerValue`.
    ///      The first 61 bytes are byte-for-byte identical to {build}, so the legacy {parse} still
    ///      reads them correctly; the cap only reads the appended tail.
    /// @param maxLpPremium Maximum taker-favorable premium over Chainlink fair value the LP will
    ///        tolerate (1e18 scale). 0 == strict fair value (LP never pays above / sells below mark).
    function buildBounded(
        uint64 k,
        uint64 maxAdjustment,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        uint8 oracleDecimals,
        uint16 maxStaleness,
        address baseToken,
        address oracleAddress,
        uint64 maxLpPremium
    ) internal pure returns (bytes memory) {
        require(maxAdjustment < SKEW_ONE, SkewPricerValueMaxAdjustmentShouldBeLessThanOneE18(maxAdjustment));
        return abi.encodePacked(
            k,
            maxAdjustment,
            baseDecimals,
            quoteDecimals,
            oracleDecimals,
            maxStaleness,
            baseToken,
            oracleAddress,
            maxLpPremium
        );
    }

    function parseMaxLpPremium(bytes calldata args) internal pure returns (uint64 maxLpPremium) {
        maxLpPremium = uint64(bytes8(args.slice(61, 69, SkewPricerValueMissingMaxLpPremiumArg.selector)));
    }

    function parse(bytes calldata args) internal pure returns (
        uint64 k,
        uint64 maxAdjustment,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        uint8 oracleDecimals,
        uint16 maxStaleness,
        address baseToken,
        address oracleAddress
    ) {
        k = uint64(bytes8(args.slice(0, 8, SkewPricerValueMissingKArg.selector)));
        maxAdjustment = uint64(bytes8(args.slice(8, 16, SkewPricerValueMissingMaxAdjArg.selector)));
        baseDecimals = uint8(bytes1(args.slice(16, 17, SkewPricerValueMissingBaseDecimalsArg.selector)));
        quoteDecimals = uint8(bytes1(args.slice(17, 18, SkewPricerValueMissingQuoteDecimalsArg.selector)));
        oracleDecimals = uint8(bytes1(args.slice(18, 19, SkewPricerValueMissingOracleDecimalsArg.selector)));
        maxStaleness = uint16(bytes2(args.slice(19, 21, SkewPricerValueMissingMaxStalenessArg.selector)));
        baseToken = address(bytes20(args.slice(21, 41, SkewPricerValueMissingBaseTokenArg.selector)));
        oracleAddress = address(bytes20(args.slice(41, 61, SkewPricerValueMissingOracleAddressArg.selector)));
    }
}

/**
 * @notice SkewPricer — inventory-healing quote skew for maker-side best execution.
 * @dev Shades the swap price by the maker's virtual-balance imbalance so the next trade heals the book:
 *  - Overstocked in the OUTGOING token  => sell it cheaper  => taker gets MORE / pays LESS (attract flow)
 *  - Scarce in the OUTGOING token        => protect the thin side => taker gets LESS / pays MORE
 *
 * Math (all fixed-point, 1e18 scale). Let `balanceIn`/`balanceOut` be the strategy's pre-trade virtual
 * balances of the tokens the taker sends / receives:
 *
 *   skew       = (balanceOut - balanceIn) / (balanceOut + balanceIn)          in [-1, +1]
 *   adjustment = clamp(k * skew, -maxAdjustment, +maxAdjustment)
 *   factor     = 1 + adjustment                                                (the price multiplier)
 *   exactIn :  amountOut *= factor                                             (round DOWN, maker-favorable)
 *   exactOut:  amountIn  /= factor                                             (round UP,   maker-favorable)
 *
 * Because `|balanceOut - balanceIn| <= balanceOut + balanceIn`, `k * skew` never exceeds `k` in magnitude,
 * so it is computed directly as `k * |diff| / (balanceOut + balanceIn)` — this cancels the intermediate
 * `1e18` factor and avoids overflow for balances up to `uint248`.
 *
 * DETERMINISM: reads only in-memory registers and packed args — no time, no external calls, no context
 * branching. `quote()` and `swap()` therefore produce byte-for-byte identical amounts by construction.
 *
 * PLACEMENT: must run AFTER the swap instruction (requires `amountIn > 0 && amountOut > 0`), mirroring
 * `OraclePriceAdjuster`. The swap instruction does not mutate the balance registers, so `balanceIn` and
 * `balanceOut` here are the pre-trade virtual balances.
 *
 * DECIMALS: the skew is measured on the raw virtual balances carried in the registers; it assumes both
 * tokens are expressed at a comparable scale. For mixed-decimal pairs (e.g. WETH/USDC) the absolute skew
 * is biased, but the relative healing behaviour (imbalance grows -> adjustment grows) still holds. See the
 * unit tests for the equal-scale correctness proofs and the fork test for the healing-sequence measurement.
 */
contract SkewPricer {
    using Math for uint256;
    using SafeCast for int256;

    error SkewPricerShouldBeAppliedAfterSwap();

    /// @param args.k             | 8 bytes (uint64, 1e18 scale)
    /// @param args.maxAdjustment | 8 bytes (uint64, 1e18 scale)
    function _skewPricer(Context memory ctx, bytes calldata args) internal pure {
        require(ctx.swap.amountIn > 0 && ctx.swap.amountOut > 0, SkewPricerShouldBeAppliedAfterSwap());

        (uint64 k, uint64 maxAdjustment) = SkewPricerArgsBuilder.parse(args);

        uint256 balanceIn = ctx.swap.balanceIn;
        uint256 balanceOut = ctx.swap.balanceOut;
        uint256 denom = balanceIn + balanceOut;
        if (denom == 0 || k == 0) {
            return; // empty book or disabled sensitivity: no adjustment
        }

        bool overstockedOut = balanceOut >= balanceIn;
        uint256 absDiff = overstockedOut ? balanceOut - balanceIn : balanceIn - balanceOut;

        // adjustment magnitude = k * |diff| / (balanceOut + balanceIn), bounded by k then by maxAdjustment
        uint256 absAdj = Math.mulDiv(uint256(k), absDiff, denom);
        if (absAdj > maxAdjustment) {
            absAdj = maxAdjustment;
        }
        if (absAdj == 0) {
            return; // balanced book (skew == 0): exact multiplier of 1.0, no-op
        }

        uint256 factor = overstockedOut ? SKEW_ONE + absAdj : SKEW_ONE - absAdj;

        if (ctx.query.isExactIn) {
            // Shade the output; floor keeps the outgoing amount maker-favorable.
            ctx.swap.amountOut = Math.mulDiv(ctx.swap.amountOut, factor, SKEW_ONE);
        } else {
            // Inverse multiplier on the input so the price scales identically to the exactIn branch;
            // ceil keeps the incoming amount maker-favorable.
            ctx.swap.amountIn = Math.mulDiv(ctx.swap.amountIn, SKEW_ONE, factor, Math.Rounding.Ceil);
        }
    }

    /// @param args.k | 8 bytes
    /// @param args.maxAdjustment | 8 bytes
    /// @param args.baseDecimals | 1 byte (e.g. 18 for WETH)
    /// @param args.quoteDecimals | 1 byte (e.g. 6 for USDC)
    /// @param args.oracleDecimals | 1 byte (Chainlink ETH/USD decimals)
    /// @param args.maxStaleness | 2 bytes (0 = skip staleness check)
    /// @param args.baseToken | 20 bytes (WETH address — identifies the volatile leg)
    /// @param args.oracleAddress | 20 bytes (Chainlink ETH/USD feed)
    /// @param args.maxLpPremium | 8 bytes OPTIONAL (uint64, 1e18) — present only for bounded args.
    ///
    /// MIDDLE GROUND (bounded mode): when `maxLpPremium` is supplied (args >= 69 bytes) the skewed
    /// quote is additionally clamped against Chainlink fair value so the LP never trades worse than
    /// the mark: the taker can never receive more USD value than they put in (± `maxLpPremium`). This
    /// keeps the inventory heal while killing the "pool at $3k, CL at $2k, skew quotes $3.5k" free-money
    /// path — takers still get better-than-XYC fills when the pool is CHEAP vs CL (bounded at fair), and
    /// the LP is protected (quote pulled down to the band) when the pool is RICH vs CL. Unbounded mode
    /// (61-byte args) is preserved byte-for-byte for backward compatibility.
    function _skewPricerValue(Context memory ctx, bytes calldata args) internal view {
        require(ctx.swap.amountIn > 0 && ctx.swap.amountOut > 0, SkewPricerShouldBeAppliedAfterSwap());

        (
            uint64 k,
            uint64 maxAdjustment,
            uint8 baseDecimals,
            uint8 quoteDecimals,
            uint8 oracleDecimals,
            uint16 maxStaleness,
            address baseToken,
            address oracleAddress
        ) = SkewPricerValueArgsBuilder.parse(args);

        uint256 ethUsd1e18 = _fetchEthUsd1e18(oracleAddress, oracleDecimals, maxStaleness);

        bool tokenInIsBase = ctx.query.tokenIn == baseToken;
        bool tokenOutIsBase = ctx.query.tokenOut == baseToken;
        uint256 valueIn = _tokenToUsd1e18(ctx.swap.balanceIn, tokenInIsBase, ethUsd1e18, baseDecimals, quoteDecimals);
        uint256 valueOut = _tokenToUsd1e18(
            ctx.swap.balanceOut, tokenOutIsBase, ethUsd1e18, baseDecimals, quoteDecimals
        );

        _applySkewFromValues(ctx, k, maxAdjustment, valueIn, valueOut);

        // Bounded mode: enforce the Chainlink LP-protection cap so healing never overpays vs fair.
        if (args.length >= SkewPricerValueArgsBuilder.BOUNDED_ARGS_LEN) {
            uint64 maxLpPremium = SkewPricerValueArgsBuilder.parseMaxLpPremium(args);
            _capToFairValue(ctx, ethUsd1e18, baseDecimals, quoteDecimals, tokenInIsBase, tokenOutIsBase, maxLpPremium);
        }
    }

    /// @dev Clamps the (already skewed) quote so the LP never trades worse than Chainlink fair value.
    ///      One-sided: it only ever pulls a taker-favorable quote back toward fair; it never improves
    ///      the taker beyond what the skew already granted. This is what bounds the "huge payout".
    ///
    ///      exactIn : usdOut <= usdIn * (1 + maxLpPremium)  => cap amountOut (round DOWN, LP-favorable)
    ///      exactOut: usdIn  >= usdOut / (1 + maxLpPremium)  => floor amountIn (round UP,   LP-favorable)
    function _capToFairValue(
        Context memory ctx,
        uint256 ethUsd1e18,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        bool tokenInIsBase,
        bool tokenOutIsBase,
        uint64 maxLpPremium
    ) internal pure {
        if (ctx.query.isExactIn) {
            uint256 usdIn = _tokenToUsd1e18(ctx.swap.amountIn, tokenInIsBase, ethUsd1e18, baseDecimals, quoteDecimals);
            uint256 usdOutCap = usdIn + Math.mulDiv(usdIn, uint256(maxLpPremium), SKEW_ONE);
            uint256 maxAmountOut =
                _usdToToken1e18(usdOutCap, tokenOutIsBase, ethUsd1e18, baseDecimals, quoteDecimals, Math.Rounding.Floor);
            if (ctx.swap.amountOut > maxAmountOut) {
                ctx.swap.amountOut = maxAmountOut;
            }
        } else {
            uint256 usdOut =
                _tokenToUsd1e18(ctx.swap.amountOut, tokenOutIsBase, ethUsd1e18, baseDecimals, quoteDecimals);
            uint256 usdInFloor = Math.mulDiv(usdOut, SKEW_ONE, SKEW_ONE + uint256(maxLpPremium));
            uint256 minAmountIn =
                _usdToToken1e18(usdInFloor, tokenInIsBase, ethUsd1e18, baseDecimals, quoteDecimals, Math.Rounding.Ceil);
            if (ctx.swap.amountIn < minAmountIn) {
                ctx.swap.amountIn = minAmountIn;
            }
        }
    }

    /// @dev Inverse of {_tokenToUsd1e18}: convert a USD value (1e18) back into token base units.
    function _usdToToken1e18(
        uint256 usd1e18,
        bool isBase,
        uint256 ethUsd1e18,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        Math.Rounding rounding
    ) internal pure returns (uint256) {
        if (isBase) {
            return Math.mulDiv(usd1e18, 10 ** uint256(baseDecimals), ethUsd1e18, rounding);
        }
        return Math.mulDiv(usd1e18, 10 ** uint256(quoteDecimals), SKEW_ONE, rounding);
    }

    function _fetchEthUsd1e18(
        address oracleAddress,
        uint8 oracleDecimals,
        uint16 maxStaleness
    ) internal view returns (uint256 ethUsd1e18) {
        IPriceOracle oracle = IPriceOracle(oracleAddress);
        (, int256 answer, , uint256 updatedAt, ) = oracle.latestRoundData();
        require(
            maxStaleness == 0 || block.timestamp <= updatedAt + maxStaleness,
            SkewPricerValueArgsBuilder.SkewPricerValueOraclePriceStale(block.timestamp, updatedAt, maxStaleness)
        );
        if (oracleDecimals == 0) {
            oracleDecimals = oracle.decimals();
        }
        ethUsd1e18 = answer.toUint256();
        if (oracleDecimals < 18) {
            ethUsd1e18 = ethUsd1e18 * 10 ** (18 - oracleDecimals);
        } else if (oracleDecimals > 18) {
            ethUsd1e18 = ethUsd1e18 / 10 ** (oracleDecimals - 18);
        }
    }

    function _tokenToUsd1e18(
        uint256 amount,
        bool isBase,
        uint256 ethUsd1e18,
        uint8 baseDecimals,
        uint8 quoteDecimals
    ) internal pure returns (uint256) {
        if (isBase) {
            return Math.mulDiv(amount, ethUsd1e18, 10 ** uint256(baseDecimals));
        }
        return Math.mulDiv(amount, SKEW_ONE, 10 ** uint256(quoteDecimals));
    }

    function _applySkewFromValues(
        Context memory ctx,
        uint64 k,
        uint64 maxAdjustment,
        uint256 valueIn,
        uint256 valueOut
    ) internal pure {
        uint256 denom = valueIn + valueOut;
        if (denom == 0 || k == 0) {
            return;
        }

        bool overstockedOut = valueOut >= valueIn;
        uint256 absDiff = overstockedOut ? valueOut - valueIn : valueIn - valueOut;

        uint256 absAdj = Math.mulDiv(uint256(k), absDiff, denom);
        if (absAdj > maxAdjustment) {
            absAdj = maxAdjustment;
        }
        if (absAdj == 0) {
            return;
        }

        uint256 factor = overstockedOut ? SKEW_ONE + absAdj : SKEW_ONE - absAdj;

        if (ctx.query.isExactIn) {
            ctx.swap.amountOut = Math.mulDiv(ctx.swap.amountOut, factor, SKEW_ONE);
        } else {
            ctx.swap.amountIn = Math.mulDiv(ctx.swap.amountIn, SKEW_ONE, factor, Math.Rounding.Ceil);
        }
    }
}
