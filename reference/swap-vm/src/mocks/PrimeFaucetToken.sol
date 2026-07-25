// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title PrimeFaucetToken
/// @notice Mintable testnet ERC20 with configurable decimals and an open faucet.
/// @dev Testnet-only demo token: mint/faucet have NO access control by design so the
///      Prime Desk UI (and the deployer) can fund any wallet without an external faucet.
///      Never deploy on mainnet.
contract PrimeFaucetToken is ERC20 {
    uint8 private immutable _decimals;

    /// @notice Fixed amount minted per `faucet()` call (in token base units).
    uint256 public immutable faucetAmount;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 faucetAmount_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
        faucetAmount = faucetAmount_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Open testnet mint (no access control — demo only).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Mint the standard faucet chunk to the caller.
    function faucet() external {
        _mint(msg.sender, faucetAmount);
    }
}
