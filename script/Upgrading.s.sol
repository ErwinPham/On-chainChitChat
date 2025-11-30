// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ChitChat} from "../src/ChitChat.sol";
import {ChitChatV2} from "../src/ChitChatV2.sol";
import {Upgrades, Options} from "openzeppelin-foundry-upgrades/Upgrades.sol";

library Deployed {
    function ChitChat() external returns (address) {
        if (block.chainid == 11155111) {
            return 0x79c175f4C66bcf294645f39B844501c3962D21c4; //proxy address
        }
    }
}

contract UpgradeChitChat is Script {
    function run() public {
        vm.startBroadcast();
        Options memory opts;
        opts.referenceContract = "ChitChat.sol";
        Upgrades.upgradeProxy(
            Deployed.ChitChat(),
            "ChitChatV2.sol", // new contract
            "",
            opts
        );
        vm.stopBroadcast();
    }
}

