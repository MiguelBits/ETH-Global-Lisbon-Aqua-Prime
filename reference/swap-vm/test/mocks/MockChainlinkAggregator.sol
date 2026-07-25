// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { IPriceOracle } from "../../src/instructions/interfaces/IPriceOracle.sol";

/// @notice Minimal settable Chainlink AggregatorV3 mock for oracle-branch unit tests.
/// @dev Mirrors the fields OraclePriceAdjuster reads: `answer`, `updatedAt`, `decimals()`.
contract MockChainlinkAggregator is IPriceOracle {
    uint8 private immutable DECIMALS;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 decimals_, int256 answer_) {
        DECIMALS = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setAnswer(int256 answer_) external {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        updatedAt = updatedAt_;
    }

    function decimals() external view returns (uint8) {
        return DECIMALS;
    }

    function description() external pure returns (string memory) {
        return "MOCK/USD";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt_, uint80 answeredInRound)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }

    function getRoundData(uint80)
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt_, uint80 answeredInRound)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
