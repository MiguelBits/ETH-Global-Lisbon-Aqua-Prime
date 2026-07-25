// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Script } from "forge-std/Script.sol";

import { Config } from "./utils/Config.sol";

import { AquaSwapVMRouter } from "../src/routers/AquaSwapVMRouter.sol";
import { PrimeSelector } from "../src/apps/PrimeSelector.sol";

// solhint-disable no-console
import { console2 } from "forge-std/console2.sol";

/// @title DeployAquaPrime
/// @notice Deploys the Aqua Prime venue: an AquaSwapVMRouter plus the PrimeSelector extruction target that
///         routes on the maker-side score. The SkewPricer / OraclePriceAdjuster instructions ship inside the
///         router (they are opcodes, not standalone contracts), so only the router + selector need deploying.
/// @dev Reads (aqua, weth, owner, name, version) from config/constants.json keyed by chainid, matching the
///      existing DeployAquaSwapVMRouter flow. Run:
///        forge script script/DeployAquaPrime.s.sol --rpc-url $RPC --broadcast
contract DeployAquaPrime is Script {
    using Config for *;

    function run() external returns (address router, address selector) {
        (
            address aquaAddress,
            address wethAddress,
            address owner,
            string memory name,
            string memory version
        ) = vm.readSwapVMRouterParameters();

        vm.startBroadcast();
        AquaSwapVMRouter swapVMRouter = new AquaSwapVMRouter(aquaAddress, wethAddress, owner, name, version);
        PrimeSelector primeSelector = new PrimeSelector(aquaAddress);
        vm.stopBroadcast();

        router = address(swapVMRouter);
        selector = address(primeSelector);

        console2.log("AquaSwapVMRouter deployed at:", router);
        console2.log("PrimeSelector    deployed at:", selector);
    }
}
// solhint-enable no-console
