// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ChitChat} from "../src/ChitChat.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";

contract ChitChatTest is Test {
    ChitChat chat; // instance proxy (cast)
    address proxy; // địa chỉ proxy

    address alice = address(0x1);
    address bob = address(0x2);

    bytes32 constant CAN_UPGRADE_ROLE = keccak256("CAN_UPGRADE_ROLE");

    function setUp() public {
        // Chạy trong VM của Foundry => không broadcast
        proxy = Upgrades.deployUUPSProxy("ChitChat.sol", abi.encodeCall(ChitChat.initialize, ()));

        // Cast địa chỉ proxy sang type ChitChat để tiện gọi hàm
        chat = ChitChat(proxy);
    }

    // ============================================================
    //                 BASIC SANITY: INIT & ROLES
    // ============================================================

    function testProxyInitializedCorrectly() public {
        // Vì test contract (address(this)) là người gọi deployUUPSProxy,
        // initialize() sẽ set owner = address(this)
        assertEq(chat.owner(), address(this));

        bytes32 adminRole = chat.DEFAULT_ADMIN_ROLE();
        assertTrue(chat.hasRole(adminRole, address(this)));
        assertTrue(chat.hasRole(CAN_UPGRADE_ROLE, address(this)));
    }

    // ============================================================
    //                     SEND / EDIT / DELETE FLOW
    // ============================================================

    function testSendEditDeleteThroughProxy() public {
        // 1) Alice gửi tin nhắn cho Bob qua proxy
        vm.prank(alice);
        chat.sendMessage(bob, "Hello Bob, I'm Alice");

        assertEq(chat.getConversationLength(alice, bob), 1);

        // 2) Alice sửa tin nhắn qua proxy
        vm.prank(alice);
        chat.editMessage(alice, bob, 0, "updated content");

        // 3) Delete tin nhắn qua proxy
        vm.prank(alice);
        chat.deleteMessage(alice, bob, 0);

        // 4) Kiểm tra delete thật sự hoạt động
        vm.prank(alice);
        vm.expectRevert(ChitChat.MessageHasBeenDeleted.selector);
        chat.editMessage(alice, bob, 0, "It will fail");
    }

    function testSendMessageRevertsViaProxy() public {
        vm.prank(alice);
        vm.expectRevert(ChitChat.EmptyContent.selector);
        chat.sendMessage(bob, "");

        vm.prank(alice);
        vm.expectRevert(ChitChat.CannotChatWithSelf.selector);
        chat.sendMessage(alice, "hi myself");

        vm.prank(alice);
        vm.expectRevert(ChitChat.InvalidAddress.selector);
        chat.sendMessage(address(0), "who is that?");
    }

    // ============================================================
    //                   EVENT EMISSION VIA PROXY
    // ============================================================

    function testMessageSentEventViaProxy() public {
        vm.prank(alice);

        //Set lại timeStamp
        vm.warp(12345);

        vm.expectEmit(true, true, true, true);
        // Foundry chỉ so sánh những field non-indexed mình đặt cố định.
        emit ChitChat.MessageSent( /*conversationId*/
            bytes32(0xb223ca6c94ac438bc67580acbf60712984058251881a79a749dff0c99c6c4b5f),
            /*from*/
            alice,
            /*to*/
            bob,
            /*index*/
            0,
            /*content*/
            "hi, I'm Alice",
            /*timestamp*/
            12345
        );

        chat.sendMessage(bob, "hi, I'm Alice");
    }

    function testMessageEditedEventViaProxy() public {
        vm.prank(alice);

        chat.sendMessage(bob, "hi, I'm Alice");

        vm.expectEmit(true, true, false, true);
        // Foundry chỉ so sánh những field non-indexed mình đặt cố định.
        emit ChitChat.MessageEdited( /*conversationId*/
            bytes32(0xb223ca6c94ac438bc67580acbf60712984058251881a79a749dff0c99c6c4b5f),
            /*index*/
            0,
            /*content*/
            "hi, I'm Alice"
        );

        vm.prank(alice);
        chat.editMessage(alice, bob, 0, "hi, I'm Alice");
    }

    function testMessageDeletedEventViaProxy() public {
        vm.prank(alice);

        chat.sendMessage(bob, "hi, I'm Alice");

        vm.expectEmit(true, true, false, false);
        // Foundry chỉ so sánh những field non-indexed mình đặt cố định.
        emit ChitChat.MessageDeleted( /*conversationId*/
            bytes32(0xb223ca6c94ac438bc67580acbf60712984058251881a79a749dff0c99c6c4b5f),
            /*index*/
            0
        );

        vm.prank(alice);
        chat.deleteMessage(alice, bob, 0);
    }
}
