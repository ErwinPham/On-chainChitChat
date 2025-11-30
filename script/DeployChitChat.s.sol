//SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChitChat} from "../src/ChitChat.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract DeployChitChat is Script {
    function run() public returns (address) {
        vm.startBroadcast();
        address proxy = Upgrades.deployUUPSProxy("ChitChat.sol", abi.encodeCall(ChitChat.initialize, ()));
        console.log("ChitChat proxy deployed at:", proxy); //proxy address
        vm.stopBroadcast();
        return proxy;
    }
}
