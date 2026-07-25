// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { Context } from "../libs/VM.sol";
import { Controls, ControlsArgsBuilder } from "../instructions/Controls.sol";
import { Decay, DecayArgsBuilder } from "../instructions/Decay.sol";
import { Extruction } from "../instructions/Extruction.sol";
import { XYCSwap } from "../instructions/XYCSwap.sol";
import { SkewPricer, SkewPricerValueArgsBuilder } from "../instructions/SkewPricer.sol";
import { AquaOpcodesDebug } from "../opcodes/AquaOpcodesDebug.sol";

/// @title AquaPrimeProgramBuilder
/// @notice Rebuilds Prime Desk selector args + extruction program for desk-set retunes.
/// @dev Top-level layout: `_decayXD` → `_extruction(PrimeSelector)` → `_salt`.
///      Decay wraps the whole desk (Mooniswap-style MEV shield) before branch pricing.
contract AquaPrimeProgramBuilder is AquaOpcodesDebug {
    using SafeCast for uint256;

    error AquaPrimeProgramBuilderOpcodeNotFound();
    error AquaPrimeProgramBuilderExtructionArgsOverflow();
    error AquaPrimeProgramBuilderZeroDecayPeriod();

    uint64 internal constant SKEW_BASELINE_K = 0;

    constructor() AquaOpcodesDebug(address(0)) {}

    /// @notice Build two-branch desk bytecode (baseline k=0 + heal with knobs).
    /// @param decayPeriod Seconds for `_decayXD` virtual-reserve fade (e.g. 300 = 5m).
    function buildDesk(
        address selector,
        uint128 lambda,
        uint64 healK,
        uint64 maxAdjustment,
        uint64 healPremium,
        uint64 programSalt,
        address baseToken,
        address oracle,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        uint8 oracleDecimals,
        uint16 maxStaleness,
        uint16 decayPeriod
    ) external view returns (bytes memory selectorArgs, bytes memory program) {
        if (decayPeriod == 0) revert AquaPrimeProgramBuilderZeroDecayPeriod();

        bytes memory baseline = _branchSkewBounded(
            SKEW_BASELINE_K, maxAdjustment, 0, baseToken, oracle, baseDecimals, quoteDecimals, oracleDecimals, maxStaleness
        );
        bytes memory heal = _branchSkewBounded(
            healK, maxAdjustment, healPremium, baseToken, oracle, baseDecimals, quoteDecimals, oracleDecimals, maxStaleness
        );
        selectorArgs = abi.encodePacked(
            lambda,
            uint8(2),
            uint16(baseline.length),
            baseline,
            uint16(heal.length),
            heal
        );

        bytes memory extructionArgs = abi.encodePacked(selector, selectorArgs);
        if (extructionArgs.length > 255) revert AquaPrimeProgramBuilderExtructionArgsOverflow();

        program = bytes.concat(
            _encode(Decay._decayXD, DecayArgsBuilder.build(decayPeriod)),
            _encode(Extruction._extruction, extructionArgs),
            _encode(Controls._salt, ControlsArgsBuilder.buildSalt(programSalt))
        );
    }

    function _branchSkewBounded(
        uint64 k,
        uint64 maxAdjustment,
        uint64 premium,
        address baseToken,
        address oracle,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        uint8 oracleDecimals,
        uint16 maxStaleness
    ) internal view returns (bytes memory) {
        return bytes.concat(
            _encode(XYCSwap._xycSwapXD, ""),
            _encode(
                SkewPricer._skewPricerValue,
                SkewPricerValueArgsBuilder.buildBounded(
                    k, maxAdjustment, baseDecimals, quoteDecimals, oracleDecimals, maxStaleness, baseToken, oracle, premium
                )
            )
        );
    }

    function _encode(
        function(Context memory, bytes calldata) internal instruction,
        bytes memory args
    ) internal view returns (bytes memory) {
        return abi.encodePacked(_findOpcode(instruction), args.length.toUint8(), args);
    }

    function _findOpcode(function(Context memory, bytes calldata) internal target)
        internal
        view
        returns (uint8)
    {
        function(Context memory, bytes calldata) internal[] memory ops = _opcodes();
        for (uint256 i = 0; i < ops.length; i++) {
            if (ops[i] == target) return i.toUint8();
        }
        revert AquaPrimeProgramBuilderOpcodeNotFound();
    }
}
